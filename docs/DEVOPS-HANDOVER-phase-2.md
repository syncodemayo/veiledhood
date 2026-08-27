# DevOps handover — Phase 2 (encrypted agents MCP)

> **One-page handover for shipping `v0.2.0` end-to-end** — PR review,
> CircleCI changes, droplet deploy, npm publish, smoke, rollback, and
> monitoring. For the deep-dive runbook with all command output and
> verbatim diffs, see `docs/DEVOPS-phase-2-mcp.md`. For the full release
> notes (test posture, threat model, ship checklist) see
> `docs/RELEASE-v0.2.0.md`.

## TL;DR

| Step | Owner | Duration |
|---|---|---|
| 1. Review PR `feat/agent-mcp → develop` | DevOps | ~30 min |
| 2. Set 10 CircleCI env vars (PROD_AGENTS_* + DEV_AGENTS_*) | DevOps | 5 min |
| 3. Apply two `.circleci/config.yml` patches (from runbook §2) | DevOps | 5 min |
| 4. Merge PR → CircleCI auto-deploys to `veiledhood-dev` | DevOps | ~3 min CI |
| 5. Staging smoke (auth → envelope → list → blindness check) | DevOps | 10 min |
| 6. 24h soak on staging | passive | 24h |
| 7. Merge `develop → main` → CircleCI auto-deploys to `veiledhood-prod` | DevOps | ~3 min CI |
| 8. Production smoke + Phase 1 regression check | DevOps | 10 min |
| 9. npm publish (`@veiledhood/agent-crypto`, `@veiledhood/mcp-server`) | DevOps | 10 min |

**No infra changes.** Same droplet (DO id `491096632`), same Mongo, same
Redis container, same PM2 processes (`veiledhood-prod` port 6619,
`veiledhood-dev` port 6629), same Tor systemd unit. Phase 2 ships in the
existing Node process alongside Phase 1.

---

## 1. PR review checklist

PR URL: <will-be-set-when-PR-is-opened>

Branch: `feat/agent-mcp`
Tag on tip: `v0.2.0`
Commits ahead of develop: 11
Target base for merge: `develop`

**Read first:** `docs/RELEASE-v0.2.0.md` — headline, threat model, what
ships, what's deferred.

### Review focus areas

| File / area | What to verify |
|---|---|
| `api/src/index.ts` | New router mounted **after** `createSwapsRouter(env)`. No existing routes reordered. |
| `api/src/middleware/rateLimit.ts` | Phase 1 `ai:rl:` Redis prefix preserved bit-identical. New `rateLimitAgents` uses `agents:rl:` (separate counter). |
| `api/src/routes/agents.ts` | Eight endpoints, every one gated by `requireAuth` + `rateLimitAgents`. Logging never touches `ciphertext`, `iv`, `salt`, or params. |
| `api/src/models/Agent.ts` | Compound unique `{address, agentId}` index. Schema stores ciphertext + iv + version + status only — **NO** plaintext fields like `params`. |
| `api/src/models/AgentEnvelope.ts` | One doc per address (unique index). |
| `api/src/config/env.ts` | Five new `AGENTS_*` vars, all with safe defaults (so server boots even without CircleCI Context updates). |
| `packages/agent-crypto` | Native WebCrypto only — no `@noble/ciphers` or other supply-chain deps. PBKDF2 600k iters (OWASP). |
| `packages/mcp-server` | stdio transport. Reads `~/.veiledhood/session.json` + `~/.veiledhood/master.key`. Never logs JWT or master key. |
| `frontend/src/lib/mcpSession.ts` | Browser-side wrap uses the **same algorithm** as agent-crypto (verified by smoke-envelope.mjs round-trip). |
| `frontend/src/components/dapp/mcp-connect-panel.tsx` | New "Agent" tab — 4th tab. Existing 3 tabs not modified other than mount point. |
| `.circleci/config.yml` | **NOT changed in this PR** — DevOps applies the diffs from `docs/DEVOPS-phase-2-mcp.md` §2 directly. |

### Privacy invariants to spot-check

1. `grep -r "params" api/src/models/` — should only appear as TypeScript types, never persisted to Mongo.
2. `grep -RE "console\.log.*ciphertext|console\.log.*iv\b|console\.log.*master" packages/ api/src/` — must return zero matches.
3. `git log feat/agent-mcp ^develop -- '*.env*'` — should show **no** `.env` file changes (secrets stay out of the diff).
4. Run all tests: `npm -w packages/agent-crypto test && npm -w packages/mcp-server test && cd api && npm test` — expect **133 / 133 pass**.

### Things that look unusual but are correct

- `frontend/` is NOT in the root `workspaces` glob — intentional, preserves CI's `cd api && npm install` behavior.
- Root `package.json` only declares `packages/*` workspaces and pulls in `@zama-fhe/relayer-sdk` as a placeholder dep — unchanged from Phase 1 baseline.
- `packages/mcp-server/bin/veiledhood-mcp.js` ESM shim explicitly calls `mod.startServer()` — silent-boot regression fix (commit `ee9b072`), pinned by `boot.test.ts`.
- AGENT_RATE_LIMIT_DISABLED defaults to `false` — only `api/src/test/setup.ts` overrides it to `true` for the test suite (Redis-free).

---

## 2. CircleCI Context — 10 new env vars

Add to the Context that already exposes `PROD_*` and `DEV_*` keys. **All five values can be identical between prod and dev**; dev values shown here are slightly relaxed for QA.

| Key | Recommended | Notes |
|---|---|---|
| `PROD_AGENTS_RATE_LIMIT_PER_USER_PER_MIN` | `30` | per-minute burst |
| `PROD_AGENTS_RATE_LIMIT_PER_USER_PER_DAY` | `500` | daily cap |
| `PROD_AGENTS_MAX_PER_USER` | `20` | max agents per wallet |
| `PROD_AGENTS_MAX_CIPHERTEXT_BYTES` | `16384` | 16 KiB per blob |
| `PROD_AGENTS_RATE_LIMIT_DISABLED` | `false` | only flip true in an emergency |
| `DEV_AGENTS_RATE_LIMIT_PER_USER_PER_MIN` | `60` | 2× prod for QA |
| `DEV_AGENTS_RATE_LIMIT_PER_USER_PER_DAY` | `2000` | 4× prod for QA |
| `DEV_AGENTS_MAX_PER_USER` | `50` | higher for testing |
| `DEV_AGENTS_MAX_CIPHERTEXT_BYTES` | `16384` | identical to prod |
| `DEV_AGENTS_RATE_LIMIT_DISABLED` | `false` | leave on |

> Skipping any of these is **safe**: `api/src/config/env.ts` has safe
> defaults that match the recommended prod values. The CircleCI Context
> entries are only needed if you want to tune without redeploying.

---

## 3. CircleCI YAML patches

Two identical-shaped edits — extend the existing `for var in … ; do`
env-var loop in both deploy jobs. Verbatim diffs in
`docs/DEVOPS-phase-2-mcp.md` §2. Summary:

- `deploy-prod` env loop (line 59-73): append five lines
- `deploy-dev` env loop (line 142-156): append the same five lines

```diff
-                      REDIS_URL; do
+                      REDIS_URL \
+                      AGENTS_RATE_LIMIT_PER_USER_PER_MIN AGENTS_RATE_LIMIT_PER_USER_PER_DAY \
+                      AGENTS_MAX_PER_USER AGENTS_MAX_CIPHERTEXT_BYTES AGENTS_RATE_LIMIT_DISABLED; do
```

Apply the same diff in both places. No new jobs, no new steps, no new
SSH keys, no new persisted workspace artifacts.

---

## 4. Droplet — what to expect

Phase 2 introduces **zero new processes** on the droplet:

- ✓ Same `veiledhood-prod` PM2 process (port 6619)
- ✓ Same `veiledhood-dev` PM2 process (port 6629)
- ✓ Same Mongo (whatever `MONGODB_URI` / `DEV_MONGODB_URI` point to — already used by Phase 1)
- ✓ Same Redis container `ai-agent-marketplace-cache-1` on host port 6379 (the `agents:rl:` keyspace is separate from `ai:rl:`)
- ✓ Same Tor systemd unit `tor-veiledhood.service` (Phase 1 — used by AI relay only; Phase 2 doesn't talk to Tor)
- ✓ Same nginx / reverse-proxy config (no new public routes outside `/agents/*` which the catch-all handles)

After deploy you should see:
- New routes available: `POST/GET/PATCH/DELETE /agents`, `POST /agents/:id/run`, `POST/GET /agents/keys/envelope`
- New Mongo collections (auto-created on first write): `agents`, `agentenvelopes`
- New log lines prefixed `[veiledhood-agents]` in `pm2 logs veiledhood-{prod,dev}`
- New rate-limit key prefix `agents:rl:` in Redis (existing `ai:rl:` keys untouched)

Quick post-deploy droplet sanity:

```bash
ssh root@167.71.59.86

# Confirm env landed
cat /var/www/veiledhood-prod/.env | grep ^AGENTS_ | sed 's/=.*/=<set>/'
# expect 5 lines with <set>

# Confirm process is healthy
export PATH=/root/.nvm/versions/node/v22.15.0/bin:$PATH
pm2 list | grep veiledhood
pm2 logs veiledhood-prod --lines 30 --nostream | grep -i error || echo "no errors"

# Confirm Phase 1 regression — Tor + Redis + SolRouter still green
curl -s http://127.0.0.1:6619/health/ai | jq
```

---

## 5. Staging deploy (auto-triggered)

Merging the PR to `develop` triggers CircleCI `build → deploy-dev`. No
manual SSH for the deploy itself.

After CircleCI is green, run the **staging smoke** from
`docs/DEVOPS-phase-2-mcp.md` §4:

1. `/health` → `{status:"ok", db:"connected"}`
2. `/health/ai` → all green (Phase 1 regression)
3. Mint a test JWT via `/auth/message` + signed `/auth/verify`
4. POST envelope to `/agents/keys/envelope` → 201
5. GET `/agents` → empty list initially → headers include `x-veiledhood-quota-min-remaining`
6. **Mongo blindness check** on `db.agents` — every document key should be one of `{_id, address, agentId, ciphertext, iv, kind, version, status, lastRunAt, createdAt, updatedAt, __v}`. **No plaintext field names** like `fromAsset`, `amountPerRun`, `targetWeights`. If any plaintext fields appear — **stop the deploy and page the API team.**
7. Let it soak 24h. Watch `pm2 logs veiledhood-dev | grep -iE 'amount|fromAsset|targetWeights' | wc -l` — expect `0` after a full day of synthetic traffic.

---

## 6. Production deploy

Merge `develop` → `main`. CircleCI runs `build → deploy-prod`.

Post-deploy smoke:

1. **Phase 1 regression** — `curl http://127.0.0.1:6619/health/ai | jq` → status `ok`, all checks `ok: true`.
2. `curl -X POST http://127.0.0.1:6619/ai/chat -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"prompt":"Say pong","model":"gpt-oss-20b","maxTokens":8}'` → 200 with model response.
3. Compare `/ai/chat` p95 latency over the next hour against pre-deploy baseline. **Tolerance ±5%.** If degraded, roll back.
4. Repeat the same envelope + agents smoke against `https://api.veiledhood.to` with a prod-funded test wallet.
5. Blindness check on prod `db.agents`.

---

## 7. npm publish (after prod smoke is green)

Both packages publish-ready as `0.1.0` (initial public release —
matches the npm convention even though the project tag is `v0.2.0`).
Dry-run already passes:

| Package | Size (packed / unpacked) | Files |
|---|---|---|
| `@veiledhood/agent-crypto@0.1.0` | 7.4 KB / 25.8 KB | 25 |
| `@veiledhood/mcp-server@0.1.0` | 19.5 KB / 75.1 KB | 55 |

### Prerequisites

- npm org `@veiledhood` exists and DevOps account has publish rights
- `NPM_TOKEN` environment variable set in DevOps shell or CI Context

### Publish in order (agent-crypto first — mcp-server depends on it)

```bash
cd packages/agent-crypto
npm publish --access public

cd ../mcp-server
npm publish --access public
```

If publishing from CI on tag push (recommended for repeatability),
configure a `.circleci/config.yml` job that:

1. Runs only on tag push matching `v*` (CircleCI `filters.tags`)
2. Restores the build workspace
3. Authenticates `npm` with `${NPM_TOKEN}`
4. `npm publish --access public` in both package dirs

(Not blocking the v0.2.0 ship — DevOps can do a manual publish first
time and add the CI job later.)

### Verify the published packages work

After publish, anyone should be able to install with:

```bash
npx -y @veiledhood/mcp-server   # transitively pulls @veiledhood/agent-crypto
```

Update the `README.md` examples to refer to the published versions (or
keep the local-path fallback for offline development).

---

## 8. Rollback (any stage)

1. Revert the merge commit on `main` (or `develop`). Push.
2. CircleCI redeploys the prior HEAD.
3. Leave the 5 `AGENTS_*` env vars set — they're inert when the
   `/agents` router isn't mounted.
4. **DO NOT** drop Mongo `agents` or `agentenvelopes` collections —
   they hold encrypted user data and would be permanent loss.
5. **DO NOT** unpublish from npm. Use `npm deprecate` if you need to
   discourage installation:
   ```bash
   npm deprecate @veiledhood/mcp-server@0.1.0 "Rolled back; see #issue"
   npm deprecate @veiledhood/agent-crypto@0.1.0 "Rolled back; see #issue"
   ```
6. Phase 1 (`/ai/chat`, Tor, Redis, SolRouter) keeps working through
   any Phase 2 rollback — Phase 2 code paths are mounted strictly
   additively.

---

## 9. Monitoring touch-points

| Signal | Where | Alert threshold |
|---|---|---|
| `/agents/*` 5xx rate | PM2 + nginx access logs | > 1% over 5 min |
| `/agents/list` p95 latency | route timing logs | > 100 ms |
| 429s on `/agents/*` | look at `pm2 logs veiledhood-prod` filtered to `[veiledhood-agents]` | spike → tune `AGENTS_RATE_LIMIT_*` |
| `/ai/chat` p95 latency | existing Phase 1 dashboard | > ±5% from pre-Phase-2 baseline |
| `/health/ai` | uptime checker (Phase 1) | > 5 min unhealthy |
| Mongo `agents` collection storage | DB metrics | unexpected growth (size cap is 16 KiB × 20 agents × N users) |
| Mongo blindness | scheduled job: `db.agents.find({fromAsset: {$exists: true}})` etc. | **any** match → page API team immediately |

---

## 10. Cost expectations

**Zero new infra cost.** Same droplet, same Mongo, same Redis, same
Tor process. Encrypted ciphertext payloads ≤16 KiB each; storage and
bandwidth deltas are negligible at any realistic user count for the
next 6 months.

npm registry is free for open-source packages.

---

## 11. Open items for DevOps to confirm before merge

- [ ] Both CircleCI Context entry sets (`PROD_*` and `DEV_*`) exist
- [ ] DevOps applies the two `.circleci/config.yml` patches from §3
- [ ] Staging API surface hostname confirmed (likely `http://127.0.0.1:6629` on the droplet or `dev.api.veiledhood.to` — update smoke commands accordingly)
- [ ] DevOps publishes `@veiledhood/agent-crypto` then `@veiledhood/mcp-server` to npm after prod smoke (manual first time, add CI job optional)
- [ ] DevOps updates the `package.json` versions before next phase (Phase 3 will bump to `0.2.0` of both packages to match the project's `v0.3.0` tag)

---

## 12. Contact / escalation

- **API team / build owner:** see commit author trailers on `feat/agent-mcp` HEAD (`5fe94a2`)
- **Privacy invariant breach** (any plaintext field in `db.agents`): immediate rollback per §8, then page the build owner
- **Phase 1 regression** on `/ai/chat`, `/health/ai`, or Tor: same — rollback per §8
- **Reference docs:**
  - `docs/RELEASE-v0.2.0.md` — full release notes, threat model, test posture
  - `docs/DEVOPS-phase-2-mcp.md` — verbatim CI diffs, end-to-end smoke commands
  - `docs/DEVOPS-phase-1-private-prompts.md` — Phase 1 deploy runbook (for regression reference)
  - `skills/veiledhood-agent/SKILL.md` + `packages/mcp-server/README.md` — end-user-facing install guides

---

## Quick summary card

```
PR:           feat/agent-mcp → develop          (5fe94a2, tag v0.2.0)
Test status:  133 / 133 pass
Build status: clean across api / frontend / 2 packages
Dry-run:      @veiledhood/agent-crypto 7.4 KB · @veiledhood/mcp-server 19.5 KB
New infra:    NONE — same droplet, Mongo, Redis, Tor, PM2 processes
CI changes:   +5 env vars in each of 2 loops (verbatim diffs in §3)
Privacy gate: Mongo blindness check on db.agents (§5 step 6)
Rollback:     revert merge; keep data; npm deprecate not unpublish
```
