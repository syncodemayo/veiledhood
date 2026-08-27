# DevOps — Phase 3 (Wallet Context) Deployment Runbook

Companion to PR `feat/wallet-context`. Mirror of `docs/DEVOPS-phase-2-mcp.md`.

## TL;DR

Phase 3 ships three new HTTP routes (`/context/shielded`, `/context/public`, `/context/full`), three new MCP tools, one optional dApp Portfolio tab, one health endpoint, and a pooled-RPC + price-oracle layer. **No new infrastructure** — same droplet, same Mongo, same Redis (assuming Redis WRONGPASS is fixed). Reuses existing `RPC_URL` and `ETH_RPC_URL` keys you already have.

Touch list:
- 11 new backend env vars (all optional with defaults)
- No new contracts
- No new databases
- No CircleCI changes required (the existing `cd api && npm install && npm run build && pm2 restart` pipeline picks everything up)
- `@veiledhood/mcp-server@0.2.0` republish to npm after merge

## Pre-merge checklist

- [ ] Redis WRONGPASS fix already shipped (see prior runbook). Phase 3 leans on Redis hard.
- [ ] Alchemy pay-as-you-go billing confirmed (no tier ceiling concern — see `~/.claude/projects/.../memory/alchemy-plan.md`).
- [ ] PR `feat/wallet-context` reviewed + CI green
- [ ] All Phase 3 tests pass: `cd api && npx tsx --test 'src/**/*.test.ts'` ≥ 122 tests passing
- [ ] MCP server tests pass: `cd packages/mcp-server && npx tsx --test 'src/**/*.test.ts'` ≥ 61 tests passing
- [ ] Frontend builds: `cd frontend && npx tsc --noEmit` clean

## Required env vars (all optional, with safe defaults)

Add to `/var/www/veiledhood-prod/.env` (and `/var/www/veiledhood-dev/.env`). Defaults are listed so you can leave them unset and we ship on the same values used in CI.

```bash
# === Rate limiting (per-user, per /context/* request) ===
CONTEXT_RATE_LIMIT_PER_USER_PER_MIN=30
CONTEXT_RATE_LIMIT_PER_USER_PER_DAY=1000
CONTEXT_RATE_LIMIT_DISABLED=false

# === Response caching ===
CONTEXT_CACHE_TTL_S=60      # 60s cache on /context/full responses (Redis-backed)

# === Pooled RPC proxy (privacy core) ===
RPC_POOL_BATCH_WINDOW_MS=100      # cross-user multicall batching window
RPC_POOL_DECOY_RATIO=0.10         # 10% decoy queries per batch
RPC_POOL_JITTER_MAX_MS=50         # 0-50ms random delay per dispatch
RPC_POOL_FAILOVER_ERROR_THRESHOLD=5
RPC_POOL_FAILOVER_WINDOW_S=30

# === Optional secondary RPC keys (for circuit-breaker failover) ===
# Uncomment when you provision a second Alchemy / QuickNode key per chain.
# BASE_RPC_URL_FALLBACK=https://...
# ETH_RPC_URL_FALLBACK=https://...

# === Price oracle ===
PYTH_HERMES_URL=https://hermes.pyth.network
PRICE_CACHE_TTL_S=30
# COINGECKO_API_KEY=...   # optional. Only needed if you upgrade to Pro tier.
```

CircleCI env vars to add (so future deploys preserve the same config — all optional since the env loader has defaults, but explicit > implicit):

```
CONTEXT_RATE_LIMIT_PER_USER_PER_MIN
CONTEXT_RATE_LIMIT_PER_USER_PER_DAY
CONTEXT_RATE_LIMIT_DISABLED
CONTEXT_CACHE_TTL_S
RPC_POOL_BATCH_WINDOW_MS
RPC_POOL_DECOY_RATIO
RPC_POOL_JITTER_MAX_MS
RPC_POOL_FAILOVER_ERROR_THRESHOLD
RPC_POOL_FAILOVER_WINDOW_S
BASE_RPC_URL_FALLBACK
ETH_RPC_URL_FALLBACK
PYTH_HERMES_URL
PRICE_CACHE_TTL_S
COINGECKO_API_KEY
```

## Where each step runs

Three environments touched. Don't mix them up:

| Env | What runs there | Why |
|---|---|---|
| **Your local machine** | git review, `npm test` gate, `npm publish` for the MCP package, `git tag v0.3.0` push | npm publish needs a logged-in npm session you don't want on the droplet; tags push from local keep keys off the server |
| **Droplet `dev` (port 6629)** | CircleCI auto-deploy on `develop` merge, smoke tests, 30-min soak | Catches env-var typos + Redis/RPC issues before prod sees them |
| **Droplet `prod` (port 6619)** | CircleCI auto-deploy on `main` merge, real user traffic, 1h soak | Last stop before users hit it |

---

## Phase A — your local machine (pre-merge gates, ~15 min)

Run these from your workstation against the PR's local checkout. Do NOT touch the droplet yet.

```bash
# 1. Pull the branch
git fetch origin
git checkout feat/wallet-context
git pull

# 2. Install (one-time per branch)
cd api && npm install && cd ..
cd packages/mcp-server && npm install && cd ../..
cd frontend && npm install && cd ..

# 3. Test gates — all three MUST be green
cd api && npx tsx --test 'src/**/*.test.ts' && cd ..        # expect ≥ 122 passing
cd packages/mcp-server && npx tsx --test 'src/**/*.test.ts' && cd ../..    # expect ≥ 61 passing
cd frontend && npx tsc --noEmit && cd ..                    # expect zero TS errors

# 4. Verify env-var diff vs prod .env (sanity check, don't paste secrets in shell history)
#    Get the env file from the droplet:
ssh root@<droplet-ip> 'cat /var/www/veiledhood-prod/.env' | sort > /tmp/prod-env.txt
#    Compare keys against the new vars in this runbook above.
#    If any of CONTEXT_*, RPC_POOL_*, PRICE_*, PYTH_*, BASE_RPC_URL_FALLBACK, ETH_RPC_URL_FALLBACK
#    are missing, you'll add them in Phase B step 2.

# 5. Manual local smoke (optional but recommended)
#    Spin up local Mongo + Redis:
docker run -d --name veiledhood-local-mongo -p 27017:27017 mongo:7
docker run -d --name veiledhood-local-redis -p 6379:6379 redis:7-alpine
#    Start API on a free port with a real Base RPC:
RPC_URL=https://mainnet.base.org INDEXER_DISABLED=true PORT=3101 \
  npm --prefix api run dev &
sleep 8
curl -s http://127.0.0.1:3101/health/context | jq
#    Expect: status=ok, redis ok, rpc ok, pyth ok, coingecko ok
#    Tear down when done:
kill %1; docker rm -f veiledhood-local-mongo veiledhood-local-redis
```

If any gate fails, do NOT merge. Comment on the PR.

---

## Phase B — droplet (deploy + soak, ~2h)

### B1. Add new env vars to droplet `.env` files

SSH to the droplet and append the Phase 3 vars from the section above to both `.env` files (defaults are fine — just put the keys with their defaults so future operators see them explicitly):

```bash
ssh root@<droplet-ip>
nano /var/www/veiledhood-dev/.env    # append Phase 3 block from above
nano /var/www/veiledhood-prod/.env   # append same block
# (do NOT restart yet — pm2 will pick up on the CircleCI deploy below)
```

Also add the same keys to CircleCI env vars (see list above) so subsequent deploys preserve them.

### B2. Merge `feat/wallet-context` → `develop`

CircleCI runs the existing pipeline. No CI config changes needed.

### B3. Confirm dev deploy

```bash
# On the droplet (or via DigitalOcean MCP tools)
curl -sS http://127.0.0.1:6629/health/context | jq
# Expect:
#   status: "ok"
#   checks.redis.ok: true
#   checks.rpc.ok: true
#   checks.pyth.ok OR checks.coingecko.ok: true
```

Verify all Phase 1 + 2 endpoints still green:
```bash
curl -sS http://127.0.0.1:6629/health/ai | jq        # Phase 1
curl -sS http://127.0.0.1:6629/agents -H 'Authorization: Bearer XXX' -i  # Phase 2 (expect 401 without JWT)
curl -sS http://127.0.0.1:6629/context/full -H 'Authorization: Bearer XXX' -i  # Phase 3 (expect 401 without JWT)
```

### B4. Soak dev for ≥ 30 min

Drive synthetic traffic via the dApp or curl:
```bash
# Replace JWT with a real one from the Agent tab
JWT="..."
for i in {1..50}; do
  curl -s -X POST http://127.0.0.1:6629/context/full \
    -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
    -d '{"chainId":8453}' -o /dev/null -w "%{http_code} %{time_total}s\n"
  sleep 0.5
done
```

Watch for:
- pm2 restart loops (`pm2 status veiledhood-dev`)
- 5xx error spike (`pm2 logs veiledhood-dev --lines 200 | grep -E "ERROR|5[0-9][0-9]"`)
- Privacy invariant — **no 40-hex addresses in logs**:
  ```bash
  pm2 logs veiledhood-dev --lines 500 --nostream | grep -oE '0x[a-fA-F0-9]{40}' | head -5
  # Expected: zero hits
  ```

### B5. Merge `develop` → `main` + prod deploy

After ≥ 30 min soak on dev with no issues. Same pipeline.

### B6. Prod soak (≥ 1h)

Same checks as B4, but on prod (port 6619). Use a wallet you control to drive real /context/full calls.

---

## Phase C — your local machine (npm publish + git tag, ~10 min)

Only run this **after** prod soak (B6) is green. These steps shouldn't run on the droplet — npm publish needs your local npm login, and tagging should come from your workstation so the signed tag is associated with your identity.

### C1. Publish `@veiledhood/mcp-server@0.2.0` to npm

```bash
# Make sure you're logged into npm as a @veiledhood org maintainer:
npm whoami    # expect your handle
npm org ls @veiledhood | grep -i $(npm whoami)    # confirm you have publish rights

cd packages/mcp-server
npm run build
npm publish --access public

# Verify:
curl -sS https://registry.npmjs.org/@veiledhood/mcp-server | jq '.["dist-tags"].latest'
# Expect: "0.2.0"

# Smoke the published package end-to-end:
npx -y @veiledhood/mcp-server@0.2.0 --help 2>&1 | head -20
# Expect: tool list including context_full, context_shielded, context_public
```

### C2. Tag `v0.3.0`

```bash
git checkout main
git pull
git tag -a v0.3.0 -m "Wallet Context — private wallet view via pooled RPC"
git push origin v0.3.0
```

### C3. Announce

Done. Post in the team channel:
> Phase 3 Wallet Context shipped. `@veiledhood/mcp-server@0.2.0` on npm. Drop-in upgrade for existing MCP users (`claude mcp update veiledhood`). dApp Portfolio tab live at app.veiledhood.to.

## Rollback

If `/health/context` is degraded for > 5 min OR /agents starts 5xx-ing:

```bash
# On droplet
pm2 stop veiledhood-prod
git -C /var/www/veiledhood-prod checkout v0.2.0    # last known good
cd /var/www/veiledhood-prod/api && npm install && npm run build
pm2 start veiledhood-prod
```

`/context/*` routes will 404 (which is fine — clients fail soft). MCP server clients pinned to `@veiledhood/mcp-server@0.1.0` keep working. v0.2.0 MCP clients will see "tool unavailable" on the 3 new context tools and continue working on the 7 existing tools.

To roll back the npm publish:
```bash
npm deprecate @veiledhood/mcp-server@0.2.0 "Rolled back — use 0.1.0 until v0.3.1"
# Users can then `npm install @veiledhood/mcp-server@0.1.0`
```
(`npm unpublish` is allowed within 72h of publish but generally avoided. `deprecate` is the safer move.)

## Monitoring after launch

Add a row to your status dashboard (or grafana board) for:

| Metric | Source | Alert threshold |
|---|---|---|
| `/health/context` status | Cron curl every 60s | 503 for > 5 min |
| Per-chain RPC error rate | `pm2 logs veiledhood-prod | grep "veiledhood-context"` | > 10 errors / 5min |
| Alchemy daily CU spend | Alchemy dashboard | $200/month projection |
| Redis `context:rl:*` key count | `redis-cli --scan --pattern 'context:rl:*' | wc -l` | sudden 10× spike |
| Pyth Hermes 5xx rate | upstream logs | continuous failures |

## Cost estimate

At pay-as-you-go billing with the defaults (60s cache, 100ms multicall window, 10% decoys):

- 1000 MAU × 4 `/context/full` calls/day each → 4000 user requests/day
- After 60s cache + multicall coalesce → ~50 actual multicall dispatches/day
- 50 multicalls × ~20 token-balance reads each = 1000 RPC calls/day
- + 10% decoys → ~1100 RPC calls/day
- + 1 Pyth Hermes call per cache window (30s TTL) → ~2880/day
- + 1 CoinGecko fallback call per cache window → ~2880/day (only when needed)

**Estimated Alchemy spend: <$20/month at 1000 MAU.** Linear scaling to 10k MAU = <$200/month, matching the plan target.

## Privacy invariants we ship

These are reviewable by inspecting the code:

1. **Multicall `from = 0x0...0`.** Verified by `pooledRpcProxy.test.ts:multicall calls never include from field`.
2. **Cross-user batching.** Verified by `pooledRpcProxy.test.ts:cross-user batching — 2 users in window → 1 multicall`.
3. **Decoy mixing.** Verified by `pooledRpcProxy.test.ts:decoys — with ratio 0.5 and 2 tokens, expect ~1 decoy added`.
4. **Address never in routes' response on error.** Verified by `context.test.ts:aggregator throws → 503 (NOT 500, NOT leaking error)`.
5. **Address comes from JWT, not request body.** Verified by `context.test.ts:caller cannot query someone else by passing address in body`.
6. **No address in CoinGecko / Pyth URLs.** Verified by `priceOracle.test.ts:priceOracle never sends the token contract address upstream`.

## Verification — end-to-end smoke from a fresh wallet

```bash
# 1. Open https://app.veiledhood.to in incognito
# 2. Connect a wallet, sign SIWE
# 3. Click Portfolio (new 5th sub-tab under Agent)
# 4. Expect: hero card with USD total, shielded + public breakdown, privacy meter
#
# 5. Install MCP server v0.2.0:
claude mcp add veiledhood --scope user -- npx -y @veiledhood/mcp-server
# 6. In Claude Code: "what's in my wallet"
# 7. Expect: formatted breakdown of shielded + public assets with USD
```

## Out of scope (deferred to v0.3.1+)

- Frontend portfolio charts / allocation pie
- Reorg detection (currently 60s TTL only)
- Per-user token discovery via Alchemy `getTokenBalances` (currently top-N hardcoded list)
- Solana support
- Historical P&L / cost basis
- Position-level intel (Aave health factor, Uniswap LP)
