# Phase 2 — Encrypted agents (MCP) — DevOps deploy runbook

Operational counterpart to PR `feat/agent-mcp`. The *only* place that
describes the new env vars, the `.circleci/config.yml` patches, the
staging-then-prod deploy order, and the smoke tests for the `/agents`
surface.

Droplet: `ai-agent-marketplace-nodejs-app` (DO id `491096632`, region fra1,
public IPs `167.71.59.86`, `134.199.189.208`) — same one as Phase 1.

PM2 processes (unchanged): `veiledhood-prod` (id 388, port 6619), `veiledhood-dev`
(id 387, port 6629). Phase 2 ships in the same Node process; no new PM2
entry, no new droplet, no new Mongo, no new Redis. Mongo and the existing
Redis container (`ai-agent-marketplace-cache-1` on host port 6379) are
reused as-is.

PM2 lives under nvm; load path:

```bash
export PATH=/root/.nvm/versions/node/v22.15.0/bin:$PATH
```

## What the PR does

| Area | Change |
|---|---|
| `api/src/models/Agent.ts` | New Mongoose model. Compound unique index `{address, agentId}`, secondary `{address, status}`. Stores `{address, agentId, kind, ciphertext, iv, version, status, lastRunAt}` — **ciphertext only, no plaintext params**. |
| `api/src/models/AgentEnvelope.ts` | New model — the wrapped master-key envelope. One doc per user. Fields `{address, salt, iv, ciphertext, iterations, version}`. |
| `api/src/middleware/rateLimit.ts` | Refactored to a parameterized helper `checkBucketsWithConfig(prefix, …)`. Existing AI keys still use prefix `ai:rl:` (Phase 1 regression-preserved bit-identical). New export `rateLimitAgents(env)` uses prefix `agents:rl:`. |
| `api/src/routes/agents.ts` | New router. Eight endpoints, all `requireAuth` + `rateLimitAgents`: POST/GET/GET-by-id/PATCH/DELETE `/agents`, POST `/agents/:id/run`, POST/GET `/agents/keys/envelope`. Logging never includes ciphertext, iv, salt, or params; addresses sliced to 10 chars. |
| `api/src/config/env.ts` | Five new env vars: `AGENTS_RATE_LIMIT_PER_USER_PER_MIN`, `AGENTS_RATE_LIMIT_PER_USER_PER_DAY`, `AGENTS_MAX_PER_USER`, `AGENTS_MAX_CIPHERTEXT_BYTES`, `AGENTS_RATE_LIMIT_DISABLED`. All have safe defaults. |
| `api/src/index.ts` | Mounts `createAgentsRouter(env)` after `createSwapsRouter(env)`. **No Phase 1 routes moved or reordered.** |
| `packages/agent-crypto/`, `packages/mcp-server/` | New workspace packages. Not deployed to the droplet — they live in CI/users' machines only. |
| `frontend/src/components/dapp/mcp-connect-panel.tsx` | New Agent tab in the dApp. Generates master key in browser, wraps with passphrase via PBKDF2-SHA256 600k + AES-256-GCM, POSTs envelope, downloads `session.json` + `master.key`. |

**Phase 1 regression posture:** all existing routes (`/ai/chat`, `/ai/config`,
`/health/ai`, `/auth/*`, `/user/*`, `/transfers`, `/withdraws`, `/swaps`)
are untouched. The new router is mounted after `createSwapsRouter`, so
Express route resolution order is preserved. The `ai:rl:` Redis key prefix
is preserved bit-identical (verified by `api/src/middleware/rateLimit.test.ts`).

## Pre-flight checks

Baseline on the droplet:

```bash
export PATH=/root/.nvm/versions/node/v22.15.0/bin:$PATH
pm2 list | grep veiledhood
node --version    # expect v22.15.0
systemctl is-active tor-veiledhood  # expect active (from Phase 1)
docker ps | grep ai-agent-marketplace-cache-1  # Redis container (Phase 1)
```

Expected: same state as after Phase 1 — `veiledhood-prod`/`veiledhood-dev`
online, Tor active, Docker Redis container running.

## Step 1 — set env vars in CircleCI Context

Add the following to the Context that exposes `PROD_*` and `DEV_*`
variables (same Context that holds `PROD_JWT_SECRET`, `DEV_REDIS_URL`,
etc.). Eight new entries total: 5 for prod, 5 for dev. Use the **same
values for prod and dev** unless you want to harden prod tighter:

| Variable | Recommended value | Notes |
|---|---|---|
| `PROD_AGENTS_RATE_LIMIT_PER_USER_PER_MIN` | `30` | per-minute burst |
| `PROD_AGENTS_RATE_LIMIT_PER_USER_PER_DAY` | `500` | daily cap |
| `PROD_AGENTS_MAX_PER_USER` | `20` | max agents per wallet |
| `PROD_AGENTS_MAX_CIPHERTEXT_BYTES` | `16384` | 16 KiB ceiling on each encrypted blob |
| `PROD_AGENTS_RATE_LIMIT_DISABLED` | `false` | leave on; only flip for emergency bypass |
| `DEV_AGENTS_RATE_LIMIT_PER_USER_PER_MIN` | `60` | doubled for QA |
| `DEV_AGENTS_RATE_LIMIT_PER_USER_PER_DAY` | `2000` | doubled for QA |
| `DEV_AGENTS_MAX_PER_USER` | `50` | higher for testing |
| `DEV_AGENTS_MAX_CIPHERTEXT_BYTES` | `16384` | identical to prod |
| `DEV_AGENTS_RATE_LIMIT_DISABLED` | `false` | leave on; tests use `AGENTS_RATE_LIMIT_DISABLED=true` only in unit tests |

Skipping any of the five is **safe** — `api/src/config/env.ts` has safe
defaults that match the recommended values (server uses 30/500/20/16384/false
when the env var is absent). The point of setting them is so we can tune
without redeploying.

## Step 2 — patch `.circleci/config.yml`

**Two edits, both extending an existing `for var in … ; do` loop.** Same
shape as Phase 1's additions. No other changes to the CI file.

### 2a. `deploy-prod` env loop (around lines 59–73)

Append the five names to the existing list. The diff:

```diff
             for var in NODE_ENV PORT \
                       MONGODB_URI JWT_SECRET JWT_EXPIRES_IN \
                       RPC_URL ETH_RPC_URL \
                       ADMIN_PRIVATE_KEY DEPLOYER_PRIVATE_KEY SIGNER_PRIVATE_KEY \
                       VAULT_ADDRESS \
                       TRANSFER_FEE_CONFIG_JSON TRANSFER_FEE_LEDGER_ADDRESS \
                       WITHDRAW_DEADLINE_MAX_SEC FHEVM_RELAYER_USE_V1 \
                       ETH_CHAIN_ID BASE_CHAIN_ID CHAIN_ID \
                       VEILEDHOOD_ETH_TRANSFER_FEE_BPS VEILEDHOOD_ETH_TRANSFER_FEE_FIXED \
                       ETH_VAULT_ADDRESS CORS_ORIGIN \
                       VEILSWAP_ADDRESS VEILSWAP_FEE_BPS VEILSWAP_TREASURY_ADDRESS \
                       SOLROUTER_API_KEY AI_MODEL_WHITELIST \
                       TOR_ENABLED TOR_SOCKS_HOST TOR_SOCKS_PORT \
                       AI_RATE_LIMIT_PER_USER_PER_DAY AI_RATE_LIMIT_PER_USER_PER_MIN AI_RATE_LIMIT_DISABLED \
-                      REDIS_URL; do
+                      REDIS_URL \
+                      AGENTS_RATE_LIMIT_PER_USER_PER_MIN AGENTS_RATE_LIMIT_PER_USER_PER_DAY \
+                      AGENTS_MAX_PER_USER AGENTS_MAX_CIPHERTEXT_BYTES AGENTS_RATE_LIMIT_DISABLED; do
```

### 2b. `deploy-dev` env loop (around lines 142–156)

Same pattern in the dev job:

```diff
             for var in NODE_ENV PORT \
                       MONGODB_URI JWT_SECRET JWT_EXPIRES_IN \
                       RPC_URL ETH_RPC_URL \
                       ADMIN_PRIVATE_KEY DEPLOYER_PRIVATE_KEY SIGNER_PRIVATE_KEY \
                       VAULT_ADDRESS \
                       TRANSFER_FEE_CONFIG_JSON TRANSFER_FEE_LEDGER_ADDRESS \
                       WITHDRAW_DEADLINE_MAX_SEC FHEVM_RELAYER_USE_V1 \
                       ETH_CHAIN_ID BASE_CHAIN_ID CHAIN_ID \
                       VEILEDHOOD_ETH_TRANSFER_FEE_BPS VEILEDHOOD_ETH_TRANSFER_FEE_FIXED \
                       ETH_VAULT_ADDRESS CORS_ORIGIN INDEXER_DISABLED \
                       VEILSWAP_ADDRESS VEILSWAP_FEE_BPS VEILSWAP_TREASURY_ADDRESS \
                       SOLROUTER_API_KEY AI_MODEL_WHITELIST \
                       TOR_ENABLED TOR_SOCKS_HOST TOR_SOCKS_PORT \
                       AI_RATE_LIMIT_PER_USER_PER_DAY AI_RATE_LIMIT_PER_USER_PER_MIN AI_RATE_LIMIT_DISABLED \
-                      REDIS_URL; do
+                      REDIS_URL \
+                      AGENTS_RATE_LIMIT_PER_USER_PER_MIN AGENTS_RATE_LIMIT_PER_USER_PER_DAY \
+                      AGENTS_MAX_PER_USER AGENTS_MAX_CIPHERTEXT_BYTES AGENTS_RATE_LIMIT_DISABLED; do
```

That's the entire CI change. No new jobs, no new steps, no new workspace
artifacts.

## Step 3 — staging deploy

When the PR merges to `develop`, CircleCI auto-runs `build` then
`deploy-dev`. No manual SSH needed for the deploy itself. Confirm via the
CircleCI UI that both jobs are green.

After deploy completes, SSH to the droplet to verify the new env vars
landed:

```bash
ssh root@167.71.59.86  # use the standard SSH key
cat /var/www/veiledhood-dev/.env | grep ^AGENTS_ | sed 's/=.*/=<set>/'
```

Expect to see all five `AGENTS_*` lines with `<set>`.

Then check the process picked them up:

```bash
export PATH=/root/.nvm/versions/node/v22.15.0/bin:$PATH
pm2 logs veiledhood-dev --lines 30 --nostream
```

Look for `[veiledhood-agents]` log lines on the first authenticated request
to `/agents`. None of them should contain ciphertext, iv, salt, or any
plaintext field names from a DCA/rebalance/yield config (e.g.
`fromAsset`, `amountPerRun`, `targetWeights`).

## Step 4 — staging smoke

From the droplet (or any machine with HTTPS access to `dev.api.veiledhood.to`,
adjust hostname if the dev surface uses a different domain):

```bash
# 4a. Phase 1 regression — must still be green
curl -s http://127.0.0.1:6629/health/ai | jq
# Expect: status="ok", redis.ok=true, tor.ok=true, solrouter.ok=true

# 4b. Phase 2 plain health
curl -s http://127.0.0.1:6629/health | jq
# Expect: status="ok", db="connected"
```

End-to-end agents smoke (use any test wallet — even a throwaway):

```bash
# Mint a JWT
MSG=$(curl -s http://127.0.0.1:6629/auth/message | jq -r .message)
# … sign MSG with the test wallet's private key, then:
JWT=$(curl -s -X POST http://127.0.0.1:6629/auth/verify \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"$MSG\",\"signature\":\"$SIG\"}" | jq -r .token)

# Upload an envelope (smoke values; replace with output from the dApp Agent tab in real testing)
curl -s -X POST http://127.0.0.1:6629/agents/keys/envelope \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"salt":"AAAAAAAAAAAAAAAAAAAAAA==","iv":"AAAAAAAAAAAAAAAA","ciphertext":"AAAAAAAAAAAAAAAAAAAAAA==","iterations":600000,"version":1}'
# Expect 201, body { ok: true, updatedAt: "…" }

# List should be empty
curl -s http://127.0.0.1:6629/agents -H "Authorization: Bearer $JWT" | jq
# Expect: { agents: [] }

# Confirm rate-limit headers present
curl -si http://127.0.0.1:6629/agents -H "Authorization: Bearer $JWT" \
  | grep -i '^x-veiledhood-quota-'
# Expect two headers: min-remaining and day-remaining
```

**Blindness check (run on the droplet):**

```bash
mongosh "$DEV_MONGODB_URI" --quiet --eval '
  const docs = db.agents.find().limit(20).toArray();
  for (const d of docs) print(Object.keys(d).sort().join(","));
'
# Every line should contain: _id,address,agentId,ciphertext,createdAt,iv,kind,status,updatedAt,version,__v
# (lastRunAt may also appear after agent_run.) NO plaintext field names like fromAsset, amount, targetWeights.
```

If any line contains plaintext field names, **stop the deploy** and page the API team. Phase 2 must never store plaintext params on the server.

## Step 5 — production deploy

Same automation: merge `develop` → `main`, CircleCI runs `build` then
`deploy-prod`. Tag the merge commit with `v0.2.0` after smoke passes.

After deploy completes, repeat **Step 4 smoke** against
`https://api.veiledhood.to` (or `http://127.0.0.1:6619` from the droplet)
with prod credentials. Plus the Phase 1 regression checks below.

## Phase 1 regression checks (must all pass post-prod-deploy)

```bash
# Tor + Redis + SolRouter all still wired
curl -s http://127.0.0.1:6619/health/ai | jq
# Expect: status="ok", redis.ok=true, tor.ok=true, solrouter.ok=true

# AI chat still works (use a real user JWT or the standing test JWT)
curl -s -X POST http://127.0.0.1:6619/ai/chat \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"prompt":"Say pong","model":"gpt-oss-20b","maxTokens":8}' | jq
# Expect 200, message containing "pong" or similar
```

If the AI surface degrades by more than ±5% in p95 latency after the
deploy, roll back per the next section.

## Rollback

1. Revert the merge commit on `main` (or `develop`); push.
2. CircleCI redeploys the prior `develop` HEAD.
3. The five new `AGENTS_*` env vars can stay set — they're inert when the
   `/agents` router isn't mounted.
4. **Do not** drop the Mongo `agents` or `agentenvelopes` collections —
   they hold user data. Revert is route-level only.
5. The Phase 1 surface (`/ai/chat`, Tor, Redis) keeps working through any
   Phase 2 rollback because Phase 2 doesn't touch those code paths.

## Monitoring touch-points

- **Phase 2 latency:** `/agents/list` p95 should stay under 100 ms (target
  in the plan). Spike alerts in the standard PM2/CloudWatch dashboard;
  filter logs by prefix `[veiledhood-agents]`.
- **Rate-limit hits:** 429 from any `/agents/*` route. Spike = an abusive
  user or under-provisioned quota. Use the new
  `AGENTS_RATE_LIMIT_PER_USER_PER_MIN` / `…_PER_DAY` dials to adjust.
- **Mongo storage:** the `agents` and `agentenvelopes` collections are
  small (16 KiB ciphertext ceiling per agent × 20 agents max × N users).
  Watch for unexpected growth which would indicate the size cap is
  bypassed.
- **`/health/ai`** still the single Phase 1 health endpoint; add nothing
  for Phase 2 — failures show up as 5xx on any `/agents/*` route which
  the existing API uptime check should already cover.

## Cost expectations

Phase 2 adds zero infra cost — same droplet, same Mongo, same Redis. The
encrypted ciphertext payloads are ≤16 KiB each; storage and bandwidth
deltas are negligible at any realistic user count.

## Open items for DevOps

- Confirm both Context entries (`PROD_*` and `DEV_*`) exist in CircleCI
  before merging to `develop`.
- Confirm the staging API surface hostname (`http://127.0.0.1:6629` or
  whatever public dev domain). Update Step 4 commands accordingly.
- Decide whether to publish the `@veiledhood/agent-crypto` and
  `@veiledhood/mcp-server` packages from CI on tag push (see Day 10 release
  notes — separate workflow, not part of this deploy runbook).
