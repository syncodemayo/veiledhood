---
name: veiledhood-agent
description: Use whenever the user wants to create, manage, run, pause, or remove a Veiledhood encrypted on-chain strategy agent (DCA, rebalance, or yield) OR check their wallet portfolio. Maps natural-language phrasing like "set up a weekly $50 USDC DCA into ETH", "list my agents", "pause the rebalance bot", "what's in my wallet", or "show me my portfolio" to the right MCP tool call so the user never has to write JSON. Required reading before invoking any veiledhood.agent_* or veiledhood.context_* tool.
---

# Veiledhood encrypted-agent skill

The user has the `veiledhood` MCP server installed (stdio, `node …/packages/mcp-server/bin/veiledhood-mcp.js` or `npx @veiledhood/mcp-server`). It exposes seven tools backed by an encrypted-at-rest agent store on `api.veiledhood.to`.

**Privacy invariant — the part the user is paying for:** strategy parameters are encrypted on the user's machine with a master key Veiledhood does not have. The Veiledhood backend stores only ciphertext + IV. The model provider (you, Claude) only sees the tool calls — never the master key, never the JWT. When you call `agent_get` or `agent_run`, the MCP server decrypts locally and returns plaintext **only to this process** — do not echo entire decrypted blobs back to the user unless they ask.

## Tools (mirror what the MCP server exports)

| Tool | When to call | Returns |
|---|---|---|
| `wallet_status` | Anytime the user asks "am I connected" / "is my session OK" or before a first call when uncertain | `{address, exp, backend: "ok" \| "unreachable"}` |
| `agent_create` | "set up a DCA / rebalance / yield" — the user has described a strategy | `{agentId, createdAt}` |
| `agent_list` | "what agents do I have", "list my bots", "show me my strategies" | array of `{agentId, kind, status, lastRunAt}` (no params) |
| `agent_get` | User asks "what does agent <id> do" / "show me my rebalance config" | full doc INCLUDING decrypted `params` (local-only) |
| `agent_update` | Pause/resume OR user wants to change params on an existing agent | `{ok, updatedAt}` |
| `agent_delete` | "delete / remove / stop the X agent" — soft delete, can't be undone | `{ok}` |
| `agent_run` | "run my DCA now", "execute the rebalance" | full doc with decrypted `params` |
| `context_shielded` | "what's in my Veiledhood vault", "show shielded balance" | shielded balances + USD per asset |
| `context_public` | "what's in my Base wallet", "show my on-chain holdings" | native + top ERC-20s + USD per asset (k-anon via pooled RPC) |
| `context_full` | "what's in my wallet", "show my portfolio", "do I have enough for X" | combined shielded + public + total USD |

## Agent kinds and their `params` schema

Always pass the param object as a plain JSON value — the MCP server stringifies and encrypts it. Default any field the user didn't specify rather than ask follow-up questions, unless ambiguous.

### `dca` — dollar-cost averaging

```jsonc
{
  "fromAsset": "USDC",          // source ticker
  "toAsset": "ETH",             // destination ticker
  "amountPerRun": "50",         // human string, NOT raw units
  "cadence": "weekly",          // hourly | daily | weekly | monthly
  "maxSlippageBps": 50,         // 50 = 0.5%; default 50 if not stated
  "expiresAt": "2026-12-31T00:00:00Z" // optional ISO timestamp
}
```

Example trigger: "set up a weekly $50 USDC into ETH DCA" → `agent_create({kind:"dca", params:{fromAsset:"USDC", toAsset:"ETH", amountPerRun:"50", cadence:"weekly", maxSlippageBps:50}})`.

### `rebalance` — keep a basket at target weights

```jsonc
{
  "targetWeights": { "ETH": 5000, "USDC": 3000, "WBTC": 2000 }, // bps; must sum to 10000
  "tolerance": 200,             // bps drift before rebalancing; default 200 (2%)
  "cadence": "daily"            // hourly | daily | weekly
}
```

Example: "rebalance my wallet to 50% ETH 30% USDC 20% WBTC daily" → `agent_create({kind:"rebalance", params:{targetWeights:{ETH:5000, USDC:3000, WBTC:2000}, tolerance:200, cadence:"daily"}})`.

### `yield` — auto-route to highest-APR pool

```jsonc
{
  "asset": "USDC",
  "protocol": "aave-v3",        // aave-v3 | compound-v3 | morpho — pick best for the asset
  "minAprBps": 300,             // 300 = 3%; default 300
  "maxAllocation": "1000"       // human string cap
}
```

Example: "yield-farm 1000 USDC into Aave with 3% minimum" → `agent_create({kind:"yield", params:{asset:"USDC", protocol:"aave-v3", minAprBps:300, maxAllocation:"1000"}})`.

## Defaults (never ask, just pick)

- `maxSlippageBps` → 50 (0.5%)
- `cadence` for DCA → `weekly`
- `cadence` for rebalance → `daily`
- `tolerance` for rebalance → 200 bps
- `minAprBps` for yield → 300

If the user says "aggressive" / "tight slippage" / "loose drift", scale the defaults proportionately (aggressive DCA = `maxSlippageBps: 100`, tight = `30`, etc.).

## Update / pause / delete

- "pause my DCA" → `agent_list` → find one with `kind:"dca"` and `status:"active"` → `agent_update({id, status:"paused"})`
- "resume" → `agent_update({id, status:"active"})`
- "change the amount to $75" → `agent_get({id})` to see current params → merge → `agent_update({id, params:{...mergedParams}})`. The MCP server will re-encrypt with the same AAD; you don't pass `kind` again.
- "delete the yield bot" → `agent_delete({id})`. Soft delete — can't be undone. Confirm before calling.

## When tools surface errors

The MCP server returns errors as a structured tool response with `isError: true`. Common codes:

| Code | Meaning | What to tell the user |
|---|---|---|
| `VEILEDHOOD_REAUTH_REQUIRED` | JWT expired or invalid | "Your Veiledhood session has expired. Open `https://app.veiledhood.to`, connect your wallet, click the **Agent** tab, and re-download `session.json` into `~/.veiledhood/`." |
| `VEILEDHOOD_MASTER_KEY_MISSING` | `~/.veiledhood/master.key` not found | "The MCP server can't find your master key. Re-download `master.key` from the Agent tab and put it in `~/.veiledhood/`." |
| `VEILEDHOOD_DECRYPT_FAILED` | Wrong master key, tampered ciphertext, or AAD mismatch | "Decryption failed — your master.key may not match this agent. Check you're using the master.key for the same wallet address." |
| `VEILEDHOOD_API_RATE_LIMITED` | Exceeded quota | Wait the time noted in the error message, then retry. |
| `VEILEDHOOD_API_NOT_FOUND` | Agent id doesn't exist or is soft-deleted | Call `agent_list` to show current agents. |

Never invent the recovery URL — it is always `https://app.veiledhood.to`.

## Privacy hygiene

- Don't repeat the user's plaintext params back in chat unless they ask — say "agent created" with the id, kind, and cadence summary instead.
- Never log or echo the JWT, the master key bytes, the iv, the salt, or the raw ciphertext.
- If the user pastes their master.key into the chat (mistake), warn them, tell them to rotate it (`agent_delete` everything, generate a fresh key on `https://app.veiledhood.to`), and refuse to act on it.

## Quick smoke

To prove the connection without modifying anything:

1. `wallet_status` — should report `address: 0x…` + `backend: "ok"`.
2. `agent_list` — empty array is fine.
3. `context_full` — returns the user's combined shielded + public balances.

If `wallet_status` returns `VEILEDHOOD_REAUTH_REQUIRED`, walk the user through the dApp recovery flow above.

## Wallet context — natural language mapping

The context tools query the user's balance picture without leaking the wallet
address to RPC providers. Use them BEFORE making agent suggestions so you can
ground recommendations in real holdings rather than guesses.

| User says | Tool to call | Notes |
|---|---|---|
| "what's in my wallet" | `context_full({})` | Defaults to Base. Pass `{chainId: 1}` for Ethereum mainnet. |
| "show my full portfolio" | `context_full({})` | |
| "do I have enough USDC for a weekly $50 DCA?" | `context_full({})` then reason about USDC totals | Cheaper than asking the user. |
| "what's my Veiledhood shielded balance" | `context_shielded({})` | Only the vault — skips on-chain. |
| "what's in my Base wallet (not Veiledhood)" | `context_public({chainId: 8453})` | Skip shielded; just public on-chain. |
| "should I rebalance to 60/40 ETH/USDC?" | `context_full({})` first, then compute the delta from current weights | |
| "am I out of balance vs my targets?" | `context_full({})` | |

**Cost discipline:** every `context_*` call is metered RPC. Don't loop. Cache the
result in working memory and reason against it for the duration of the
conversation. Only refetch if the user explicitly asks for a refresh or you've
made an on-chain change that should be reflected.

**Privacy note for users:** if the user asks "is anyone watching my wallet
queries?", the honest answer is: the RPC provider sees a cohort of Veiledhood
queries, not your specific address. Within a 100ms batch window your query is
mixed with all other Veiledhood users' queries plus ~10% decoys. It is k-anonymous,
not fully unlinkable.
