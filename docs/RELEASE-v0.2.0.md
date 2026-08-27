# v0.2.0 — Encrypted agents MCP (Phase 2)

> **Status:** branch `feat/agent-mcp` is tagged `v0.2.0` locally. Ready
> to push, open PR `feat/agent-mcp → develop`, hand off to DevOps via
> `docs/DEVOPS-phase-2-mcp.md`, and (after staging soak) merge into `main`.

## Headline

Any MCP client (Claude Code, Claude Desktop, Cursor, Continue, Cline)
can now create, list, run, pause, and delete **encrypted on-chain
strategy agents** (DCA, rebalance, yield) on Veiledhood. The strategy
parameters never leave the user's machine in plaintext — Veiledhood's
backend stores ciphertext + IV + AAD-bound metadata only; the LLM
provider sees the tool calls but not the master key or wrapped envelope.

## What ships

| Surface | What |
|---|---|
| `api/src/routes/agents.ts` | New `/agents` CRUD (8 endpoints), `requireAuth` + `rateLimitAgents` gated. Server is blind to params. |
| `api/src/models/Agent.ts`, `…/AgentEnvelope.ts` | Mongoose models. Compound unique index `{address, agentId}`; one envelope per user. |
| `api/src/middleware/rateLimit.ts` | Parameterized helper. Phase 1 `ai:rl:` prefix bit-identical; Phase 2 uses `agents:rl:`. |
| `packages/agent-crypto` | First public release (0.1.0). Native WebCrypto, zero runtime deps. HKDF + AES-256-GCM + PBKDF2-SHA256 (600k iters) envelope wrap. |
| `packages/mcp-server` | First public release (0.1.0). stdio transport, 7 tools (`agent_*` + `wallet_status`). Reads `~/.veiledhood/session.json` + `~/.veiledhood/master.key`. |
| `frontend/src/components/dapp/mcp-connect-panel.tsx` | New **Agent** tab. Generates master key in browser, wraps with passphrase, POSTs envelope, downloads `session.json` + `master.key`. |
| `skills/veiledhood-agent/SKILL.md` | Claude Code skill — maps natural-language strategy descriptions to the right `agent_create` call. |
| `packages/mcp-server/README.md` | One-time Agent-tab setup + per-client install (Claude Code · Claude Desktop · Cursor · Continue · Cline). |
| `docs/DEVOPS-phase-2-mcp.md` | DevOps runbook with verbatim CircleCI diffs, env vars, smoke, regression, rollback. |

## Privacy invariants

- **Server-blind by construction.** API stores `{ciphertext, iv, kind, version, status, lastRunAt, timestamps}` only. AAD = `JSON.stringify({kind, version})` prevents kind-swap attacks. Verified by `db.agents.find()` blindness check + the `api/src/routes/agents.test.ts` suite (32 tests).
- **Master key never leaves user's machine.** Generated via `crypto.getRandomValues(32)` in the dApp browser. Wrapped via PBKDF2 (600k iters, OWASP 2023) + AES-GCM with the user's passphrase. Veiledhood stores the wrapped envelope only.
- **LLM never sees the master key or JWT.** MCP server reads both from `~/.veiledhood/*` on boot; never logs them. Decrypted params surface only to the local MCP process — they're tool-call results, not chat content.

## Test posture

133 / 133 tests pass across the project:

| Package | Tests | Pass | Duration |
|---|---|---|---|
| `@veiledhood/agent-crypto` | 31 | 31 | 154 ms |
| `@veiledhood/mcp-server` | 50 | 50 | 1.77 s |
| `veiledhood-api` | 52 | 52 | 4.32 s |

Including:
- RFC 5869 HKDF Test Case 1 + AES-GCM tamper detection
- Cross-device envelope round-trip (encrypt machine A → decrypt machine B)
- ZodRawShape contract regression test (`schema-shape.test.ts`)
- Bin-shim boot regression test (`boot.test.ts` — added during Day 6 hardening)
- AAD mismatch and decryption failure paths
- Size limit (413), count limit (409), soft-delete invisibility, cross-user isolation in `/agents` route tests
- Phase 1 `ai:rl:` Redis key-shape contract preserved bit-identical

End-to-end smoke (local; not in CI):
- `packages/mcp-server/scripts/smoke-bootstrap.mjs` — mints SIWE JWT + writes `~/.veiledhood/{session.json, master.key}`
- `…/smoke-driver.mjs` — drives the 7 MCP tools over real stdio, verifies round-trip
- `…/smoke-envelope.mjs` — proves Day 7 wire shape (frontend → API → Mongo) is byte-identical

## Build sizes

- `api/dist/src` total: **374 KB** (Phase 1 + Phase 2 combined). Net Phase 2 delta TBD vs. `main` after the merge.
- `@veiledhood/agent-crypto@0.1.0` tarball: **7.4 KB** packed / 25.8 KB unpacked, 25 files
- `@veiledhood/mcp-server@0.1.0` tarball: **19.5 KB** packed / 75.1 KB unpacked, 55 files

`npm publish --dry-run` succeeds for both packages. No tests, sources, or maps from `src/*.test.ts` are shipped — only `dist/` + `bin/` + `README.md`.

## Threat model summary

| Adversary | Sees | Can do |
|---|---|---|
| Veiledhood API operator | ciphertext, iv, kind, status, timestamps | invalidate / rate-limit; cannot decrypt without your passphrase **and** master key |
| Anthropic / OpenAI / model provider | tool call names, plaintext chat scrollback | observe what tools were called and any plaintext the user pastes; cannot derive master key or decrypt past agents |
| Network observer | TLS to `api.veiledhood.to`; nothing meaningful | nothing |
| Wallet compromise alone | re-auth as user | list agents (metadata), but **cannot decrypt** without `master.key` |
| `master.key` + JWT compromise | full decryption of agents | rotate by deleting `~/.veiledhood/master.key`, generating a fresh one from the Agent tab — invalidates old agents |

## Out of scope (deferred)

| Feature | Phase |
|---|---|
| HTTP+SSE transport (ChatGPT Desktop / cloud agents) | 3 |
| Per-agent sub-key derivation (chicken-and-egg with server-gen `agentId`) | 3 |
| OS-keychain integration (Keychain / Credential Manager / libsecret) | 3 |
| Server-side encrypted search / partial decrypt | never — incompatible with blind-server model |
| Automated cron-driven `agent_run` (Phase 2 = client-initiated only) | 3 |
| Multi-sig agent ownership / shared envelopes | 3+ |
| RPC pooled-proxy + decoy queries (public-chain wallet context) | 3 (original Task 3) |

## Ship checklist

Local-only state today:

- [x] Branch `feat/agent-mcp` — 11 commits ahead of `develop`
- [x] Tag `v0.2.0` placed locally on the tip of the branch
- [x] All 133 tests pass; all packages build clean
- [x] `npm publish --dry-run` clean for both packages
- [x] DevOps runbook ready (`docs/DEVOPS-phase-2-mcp.md`)
- [ ] Push branch + tag — **awaiting user authorization**
- [ ] Open PR `feat/agent-mcp → develop` with this release note linked
- [ ] DevOps applies CI diffs from runbook
- [ ] CircleCI deploys to `veiledhood-dev` (staging)
- [ ] Staging smoke (Step 4 of the DevOps runbook) — all green
- [ ] 24h soak on staging
- [ ] Merge to `main` — CircleCI deploys to `veiledhood-prod`
- [ ] Prod smoke — `/health/ai` green, blindness check on `db.agents` clean
- [ ] Publish `@veiledhood/agent-crypto@0.1.0` + `@veiledhood/mcp-server@0.1.0` from CI on tag push (separate workflow; not part of this deploy)

## Phase 3 hand-off

Demo-ready outputs from this build:

- A Phase 2 user can: open `https://app.veiledhood.to`, connect wallet, set passphrase, download two files, install MCP in any of five clients, then say to their agent *"set up a weekly $50 USDC into ETH DCA"* and watch it create an encrypted strategy that neither Veiledhood nor the LLM provider can read.
- The Mongo `agents` collection holds ciphertext + iv + metadata only. Repeatable proof via the blindness check in the DevOps runbook.
- The `@veiledhood/agent-crypto` package can be reused stand-alone by any future privacy-conscious tool that needs a small, audited WebCrypto envelope helper.

Phase 3 ("Confidential wallet context", original Task 3 from the project plan) builds on this surface — adds `/context/wallet` routes + pooled-RPC proxy + decoy queries, and three new MCP tools (`veiledhood.context_shielded`, `…_public`, `…_full`). Effort estimate per the project plan: 11–16 days.

## Commit ledger (Phase 2)

| Tag | Day | Commit | Subject |
|---|---|---|---|
| | 1 | `55f4b08` | workspaces + Agent model + env vars |
| | 2 | `63eeff4` | agent-crypto: HKDF + AES-GCM + envelope |
| | 3 | `4e693c7` | `/agents` CRUD + envelope endpoints |
| | 4 | `06dcc58` | `/agents` route tests + memory-server |
| | 5 | `20fab17` | MCP stdio + session bootstrap |
| | 6 | `0374f34` | seven encrypted-agent tools + master key |
| | 6.5 | `ee9b072` | fix: bin shim must invoke startServer |
| | 7 | `8b8283b` | MCP-connect panel + envelope upload (dApp) |
| | 8 | `c2379e9` | skill + per-client install docs |
| | 9 | `3fa05b6` | DevOps runbook (CI handoff) |
| `v0.2.0` | 10 | _this commit_ | release notes + final regression |
