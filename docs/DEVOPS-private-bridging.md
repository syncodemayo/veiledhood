# Private Base↔Eth Bridging — DevOps deploy runbook

Operational counterpart to PR `feat/private-bridging`. Adds a backend bridge
orchestrator + `/bridge` routes + a dApp "Bridge" tab that move a user's
shielded balance between the Base and Ethereum vaults privately, settling the
liquidity hop over **deBridge DLN**.

**Unlike the prior phases, this one is NOT zero-touch.** It needs a funded
escrow signer and is **money-moving**, so it ships **disabled by default**
(`BRIDGE_ENABLED=false`) and must pass a staging E2E before being enabled in
prod.

Droplet: `ai-agent-marketplace-nodejs-app` (167.71.59.86, fra1).
PM2: `veiledhood-prod` (port 6619), `veiledhood-dev` (port 6629).

PM2 lives under nvm; load PATH before any pm2 command:

```bash
export PATH=/root/.nvm/versions/node/v22.15.0/bin:$PATH
```

---

## What the PR does

| Area | Change |
|---|---|
| `api/src/models/Bridge.ts`, `Counter.ts` | New `bridges` + `counters` collections (ciphertext-free; bridge state + tx hashes + an atomic escrow nonce). Additive — **no migration**. |
| `api/src/config/env.ts` | Adds bridge env vars (below). All have zod defaults; bridging stays **off** unless `BRIDGE_ENABLED=true`. |
| `api/src/services/bridge*.ts` | Orchestrator state machine, deBridge DLN REST client, escrow HD-key derivation, gas top-up, source/dest leg services, fee math. No `Veiledhood.sol` change. |
| `api/src/routes/bridge.ts` | `POST /bridge/fee-quote`, `POST /bridge`, `GET /bridge/:id`. Auth + per-user rate limit (`bridge:rl:`) + `BRIDGE_ENABLED` gate, Base↔Eth only. |
| `api/src/index.ts` | Mounts the router; resumes non-terminal bridges on boot (only when `BRIDGE_ENABLED=true`). |
| `frontend/` | "Bridge" tab (USDC + ETH), direction from the network toggle. Needs `NEXT_PUBLIC_*` only (no secrets). |

---

## New env vars (`/var/www/veiledhood-prod/.env`)

| Var | Required? | Default | Notes |
|---|---|---|---|
| `BRIDGE_ENABLED` | to enable | `false` | Master switch. Leave `false` until staging E2E passes. |
| `BRIDGE_ESCROW_SEED` | **yes, to enable** | — | **SECRET.** BIP-39 mnemonic used to derive a fresh escrow address per bridge. Generate offline; store in the secret manager; never commit/log. |
| `BRIDGE_GAS_PRIVATE_KEY` | no | falls back to `ADMIN_PRIVATE_KEY` | **SECRET.** Private key of the wallet that fronts native-ETH gas to escrow addresses. Leave **unset** to use the existing admin signer `0x661C739d315Bb7c9aFd80953E83FC5826435452B` (which already pays all protocol gas). Set it only to dedicate a *separate* hot wallet (avoids nonce contention with admin payouts). Privileged calls (`adminWithdraw`/`updateMerkleRoot`) always use `ADMIN_PRIVATE_KEY` regardless. |
| `DEBRIDGE_API_URL` | no | `https://dln.debridge.finance/v1.0` | deBridge create-tx host. |
| `DEBRIDGE_STATS_API_URL` | no | `https://dln-api.debridge.finance/api` | deBridge order-status host (different host). |
| `DEBRIDGE_REFERRAL_CODE` | no | — | Optional integrator code. |
| `BRIDGE_FEE_BPS` | no | `0` | Veiledhood's own bridge fee, basis points. |
| `BRIDGE_USER_DAILY_QUOTA` | no | `10` | Max bridges/user/day (rate-limited). |

Reuses existing `RPC_URL`/`VAULT_ADDRESS` (Base) and `ETH_RPC_URL`/`ETH_VAULT_ADDRESS`/`ETH_CHAIN_ID` (Ethereum), plus `ADMIN_PRIVATE_KEY`/`SIGNER_PRIVATE_KEY`. **`ETH_RPC_URL` + `ETH_VAULT_ADDRESS` must be set** — Eth→Base bridging needs them.

Frontend build needs `NEXT_PUBLIC_ETH_CHAIN_ID` (already used) — no new public vars.

CircleCI: add the new vars to the env-injection loop (same place as the phase-1/2/3 vars). Only `BRIDGE_ESCROW_SEED` is sensitive — add it as a protected context var, not plaintext.

---

## Funding requirements (the new operational cost)

Bridging is **self-funding** for principal (the user's own shielded funds move),
but the protocol fronts **gas** for the escrow addresses and **deBridge fees**:

1. **The gas wallet must hold native gas on BOTH chains.** Each bridge sends a
   small ETH top-up from the **bridge gas wallet** to a fresh escrow on the
   source chain (to submit the deBridge order) and on the destination chain (to
   call `deposit`). Budget ≈ 2 escrow-funding txs + 1 order tx + 1 deposit tx of
   gas per bridge.
   - The gas wallet is `BRIDGE_GAS_PRIVATE_KEY` if set, else the admin signer
     `0x661C739d315Bb7c9aFd80953E83FC5826435452B` (the default — this is the
     wallet that does bridge fees).
   - Fund **that** address with ETH on Base **and** Ethereum; alert when either
     drops below a threshold. Get the address from the key (never print the key):
     `node -e "console.log(new (require('ethers').Wallet)(process.env.BRIDGE_GAS_PRIVATE_KEY||process.env.ADMIN_PRIVATE_KEY).address)"`
2. **deBridge solver fee** is deducted from the bridged amount (the user bears
   it; surfaced in the fee-quote). No treasury cost.
3. **Leftover escrow gas** (the top-up minus actual gas used) stays at the
   fresh escrow address. v1 does not sweep it back — it's dust per bridge but
   accumulates; a periodic sweep is a future ops job.

---

## Deploy sequence

```bash
# 1) Pull + install + build (standard)
cd /var/www/veiledhood-prod
git fetch && git checkout develop && git pull
cd api && npm ci && npm run build

# 2) Add the env vars — KEEP BRIDGE_ENABLED=false for now
#    (edit /var/www/veiledhood-prod/.env; set BRIDGE_ESCROW_SEED from the secret store)

# 3) Restart, confirm the API is healthy with bridging still OFF
export PATH=/root/.nvm/versions/node/v22.15.0/bin:$PATH
pm2 restart veiledhood-prod
curl -s http://127.0.0.1:6619/health/ai | jq   # phase-1 regression guard, expect ok
```

With `BRIDGE_ENABLED=false`, every `/bridge*` route returns `503` and the boot
resume is skipped — safe to deploy ahead of enabling.

### Staging E2E gate (before enabling in prod)

On `veiledhood-dev` (port 6629) with `BRIDGE_ENABLED=true`, a funded
`BRIDGE_ESCROW_SEED` admin (ETH gas on both chains), and a small shielded USDC
balance:

```bash
# obtain a JWT via the normal SIWE flow, then:
TOKEN=...   # bearer
curl -s -XPOST http://127.0.0.1:6629/bridge/fee-quote -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"sourceChainId":8453,"destChainId":1,"currency":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","amount":"1000000"}' | jq
# then POST /bridge with the same body -> {bridgeId}, poll GET /bridge/<id> to "complete"
```

Confirm on-chain: source `adminWithdraw` to a fresh escrow, a deBridge order, a
dest `deposit`, and the user's destination shielded balance increased by the
received amount. **Privacy assertion:** the user's main wallet appears in ZERO
bridge transactions. Repeat Eth→Base and once with native ETH.

### Enable in prod

```bash
# only after the staging E2E passes
# set BRIDGE_ENABLED=true in /var/www/veiledhood-prod/.env
pm2 restart veiledhood-prod
curl -i -s -XPOST http://127.0.0.1:6619/bridge/fee-quote -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"sourceChainId":8453,"destChainId":1,"currency":"native","amount":"10000000000000000"}'
# expect 200 with a quote (not 503)
```

---

## Mongo sanity (bridges are ciphertext-free state, not user secrets)

```bash
node -e "
  import mongoose from 'mongoose';
  await mongoose.connect(process.env.MONGODB_URI);
  const B = mongoose.model('Bridge', new mongoose.Schema({}, {strict:false,collection:'bridges'}));
  for (const d of await B.find().sort({createdAt:-1}).limit(5).lean())
    console.log(d.bridgeId, d.status, d.sourceChainId, '->', d.destChainId, d.amountRequested);
"
```

---

## Rollback

`BRIDGE_ENABLED=false` + `pm2 restart veiledhood-prod` instantly disables all
bridge routes and boot resume. **Caveat:** a bridge already past
`bridge_fulfilled` has funds in flight/on the destination escrow — disabling
stops *new* bridges and pauses resume, but in-flight ones need either re-enabling
to finish or a manual ops completion. Prefer disabling only when no bridge is in
a non-terminal state:

```bash
node -e "
  import mongoose from 'mongoose';
  await mongoose.connect(process.env.MONGODB_URI);
  const B = mongoose.model('Bridge', new mongoose.Schema({}, {strict:false,collection:'bridges'}));
  console.log('in-flight:', await B.countDocuments({status:{\$nin:['complete','failed','refunded']}}));
"
```

The full code rollback is a normal `git revert` of the PR merge + redeploy; the
new collections are additive and harmless if left in place.

---

## Monitoring

- Bridge gas-wallet balance on Base **and** Ethereum (alert on low) — the
  `BRIDGE_GAS_PRIVATE_KEY` wallet, or the admin signer if unset.
- `bridges` with `status='failed'` (refunded — investigate the `error` field).
- `bridges` stuck in a non-terminal status > ~15 min (resume should clear on
  reboot; a persistent stick means a deBridge/RPC issue).
- deBridge API error rate (the client throws `DeBridgeApiError` with status).

---

## Known v1 limitations (see the spec's follow-ups)

- Destination credit goes to the user's own address (not yet a fresh per-bridge
  shielded address).
- Leftover escrow gas is not swept; post-withdraw on-chain escrow recovery (if a
  bridge fails after the source withdrawal) is a manual sweep.
- Native-ETH `received` is the dest escrow's pre-gas balance — verified during
  staging E2E.
