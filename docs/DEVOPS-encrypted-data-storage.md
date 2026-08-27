# Encrypted Data Storage — DevOps deploy runbook

Operational counterpart to PR `feat/encrypted-data-storage`. Adds a generic
`kind="data"` surface to the existing `/agents` route + three new MCP tools
(`data_store`, `data_fetch`, `data_list`) for partners storing arbitrary
encrypted blobs (files, docs, configs, anything).

**Zero new infra.** Same droplet, same PM2 process, same Mongo collection,
same Redis. Two new env vars with safe defaults. No CI changes.

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
| `api/src/config/env.ts` | Adds `DATA_MAX_CIPHERTEXT_BYTES` (default 1_048_576 = 1 MB) + `DATA_MAX_PER_USER` (default 100). Both have zod defaults; **neither is mandatory in `.env`**. |
| `api/src/index.ts` | Bumps `express.json()` limit from default 100kb → **2 MB**. Required so data blobs reach the route's typed 413 handler instead of express's opaque body-parser 413. |
| `api/src/models/Agent.ts` | Mongoose enum gains `"data"`. Schema otherwise unchanged. **No migration needed** — additive enum value. |
| `api/src/routes/agents.ts` | (a) `createBody` kind enum gains `"data"`. (b) Payload cap is now per-kind: `data` → `DATA_MAX_CIPHERTEXT_BYTES`, all others → `AGENTS_MAX_CIPHERTEXT_BYTES`. (c) Per-user count cap is per-kind: `data` → `DATA_MAX_PER_USER` (100), agents → `AGENTS_MAX_PER_USER` (20) — independent. (d) `GET /agents` accepts optional `?kind=` filter. (e) PATCH does a kind-lookup before applying the cap. |
| `api/src/test/setup.ts` | Test body-parser raised to 2 MB to match prod. |
| `packages/mcp-server/src/tools/dataStore.ts` | New. Encrypts `{label, data, savedAt}` with the user's master key, POSTs `kind="data"` to `/agents`. |
| `packages/mcp-server/src/tools/dataFetch.ts` | New. GET + decrypt + parse. Rejects non-`data` kinds with a clear "use agent_get" hint. |
| `packages/mcp-server/src/tools/dataList.ts` | New. GET `/agents?kind=data`. Lists ids + timestamps only (labels stay encrypted). |
| `packages/mcp-server/src/server.ts` | Registers the 3 new tools. **Version bumped 0.2.0 → 0.3.0.** |
| `packages/mcp-server/package.json` | Version 0.3.0 + description updated. |
| `docs/partnerships/encrypted-data-storage.md` | New partner-facing integration guide (Option A: direct `@veiledhood/agent-crypto` library; Option B: hosted MCP). |
| `docs/partnerships/bloom-integration.md` | Renamed from `agent-crypto-integration.md`. Bloom-specific guide with the corrected API signatures. |
| `landing-page/src/components/landing/use-cases.tsx` | "Privacy-Native DeSci" card → "Encrypted Data Storage" (DeSci becomes one bullet under the broader framing). Icon `FlaskConical` → `Database`. |
| `landing-page/src/components/landing/hero.tsx` + `pillars.tsx` | Pillar strip updated for consistency. |
| `api/scripts/`, `packages/mcp-server/scripts/` | Two local-test scripts. Not deployed; live in source for repeatable smoke tests. |

**Test counts:**
- API: 129 → **137** (8 new in `agents.data.test.ts`)
- MCP server: 61 → **68** (7 new in `tools/data.test.ts`)
- All green locally; 33 additional end-to-end checks run against a live local API in two script-driven smokes (see PR description).

---

## Pre-flight checks

Baseline on the droplet:

```bash
export PATH=/root/.nvm/versions/node/v22.15.0/bin:$PATH
pm2 list | grep veiledhood           # both prod + dev should be online
curl -sS http://127.0.0.1:6619/health   # prod health
curl -sS http://127.0.0.1:6629/health   # dev health
```

If both 200 — proceed.

---

## Phase B — Droplet changes (~3 minutes)

### 1. Optional: add tuning env vars to `.env`

Both new vars have safe defaults. Add explicitly **only if** you want to override them.

`/var/www/veiledhood-prod/.env` and `/var/www/veiledhood-dev/.env`:

```bash
# === Encrypted Data Storage (new in 0.3.0) ===
# DATA_MAX_PER_USER=100              # default 100 — uncomment to tune
# DATA_MAX_CIPHERTEXT_BYTES=1048576  # default 1 MB — uncomment to tune
```

Defaults work for v1 launch. Skip if you don't want to override.

### 2. Merge `feat/encrypted-data-storage` → `develop` (triggers CircleCI dev deploy)

```bash
# Standard PR merge via GitHub UI or:
gh pr merge <PR#> --squash --auto
```

CircleCI runs `cd api && npm install && npm run build && pm2 restart veiledhood-dev`.
No CI config changes required.

### 3. Soak on dev (≥15 min for an additive change, ≥30 min if you want to be extra careful)

```bash
# Dev health stays green
watch -n 10 'curl -sS http://127.0.0.1:6629/health/ai'

# pm2 stable
pm2 logs veiledhood-dev --lines 50 --nostream | grep -iE "error|crash" | head

# Smoke kind=data on dev (need a JWT for a dev wallet):
curl -sS -X POST http://127.0.0.1:6629/agents \
  -H "Authorization: Bearer $DEV_JWT" \
  -H "Content-Type: application/json" \
  -d '{"kind":"data","ciphertext":"YWJj","iv":"MTIzNDU2","version":1}'
# expect 201 + agentId
```

### 4. Merge `develop` → `main` (triggers CircleCI prod deploy)

```bash
git checkout main && git pull
git merge --ff-only develop
git push origin main
```

Or via GitHub PR with auto-merge.

### 5. Verify prod

```bash
pm2 list | grep veiledhood-prod   # online, recent restart, no restart loop
curl -sS http://127.0.0.1:6619/health | jq

# Mongo sanity — confirm kind enum now accepts "data":
mongosh "$MONGODB_URI" --quiet --eval '
  db.agents.aggregate([{ $group: { _id: "$kind", n: { $sum: 1 } } }])
'
```

No new collections, no schema migration. Existing agents continue to work.

---

## Phase C — Your local machine (~2 minutes)

### 1. Publish `@veiledhood/mcp-server@0.3.0`

```bash
cd packages/mcp-server
npm run build
npm publish --access public
```

You should see:
```
+ @veiledhood/mcp-server@0.3.0
```

Verify on npm:
```bash
npm view @veiledhood/mcp-server version  # expect 0.3.0
```

### 2. Tag the release

```bash
cd <repo root>
git checkout main && git pull
git tag -a v0.4.0 -m "Encrypted data storage — data_store / data_fetch / data_list MCP tools"
git push origin v0.4.0
```

(Version bump is `v0.4.0` since `v0.3.0` was the Phase 3 Wallet Context tag.)

---

## Post-deploy verification

End-to-end smoke from any machine with the MCP installed (Phase A users):

```bash
# Update MCP client to pin 0.3.0 (or unpin to get latest)
# Then restart Claude Code / Claude Desktop / Cursor

# In an MCP-aware chat:
"store an encrypted note labeled 'smoke-test' with contents 'hello world'"
# → Claude calls data_store, returns id

"list my encrypted data"
# → Claude calls data_list, shows 1 blob

"fetch that blob"
# → Claude calls data_fetch, returns label + data + savedAt
```

Privacy invariant — on the droplet:

```bash
mongosh "$MONGODB_URI" --quiet --eval '
  const doc = db.agents.findOne({ kind: "data" });
  printjson(Object.keys(doc).sort());
'
# Expect:
# [ "_id", "address", "agentId", "ciphertext", "createdAt", "iv", "kind", "status", "updatedAt", "version" ]
# Must NEVER contain "label", "data", or any plaintext field.
```

---

## Rollback

Both code changes are additive. Worst case: revert the merge commit + restart:

```bash
# Revert merge on main
git revert -m 1 <merge-commit-sha>
git push origin main
# CircleCI auto-deploys the revert

# Existing kind="data" docs survive (data stays in Mongo).
# They become unreadable through /agents until 0.3.0 redeploys, but
# nothing is destroyed.
```

For the npm package: `npm deprecate @veiledhood/mcp-server@0.3.0 "rolled back"` — then republish 0.2.1 with whatever hotfix is needed.

No env-var rollback needed (defaults handle absence).

---

## What's NOT in this PR (defer to follow-ups)

- Sharing encrypted blobs between users (needs key-wrap protocol)
- File-size > 1 MB (current cap, raise via `DATA_MAX_CIPHERTEXT_BYTES` if needed)
- Pay-per-MB pricing
- REST `/vault/encrypted` alias for non-MCP integrators
- Frontend UI for managing encrypted blobs (current launch is MCP-only)

---

*Last updated: 2026-05-31. Authored against branch `feat/encrypted-data-storage` at HEAD.*
