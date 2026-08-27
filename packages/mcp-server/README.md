# @veiledhood/mcp-server

Veiledhood's [Model Context Protocol](https://modelcontextprotocol.io) server. Lets any MCP client (Claude Code, Claude Desktop, Cursor, Continue, Cline, …) create and run **encrypted on-chain agent strategies** without leaking the strategy parameters to Veiledhood or to the LLM provider.

- Sixteen tools: agent ops (`agent_create`, `agent_list`, `agent_get`, `agent_update`, `agent_delete`, `agent_run`), encrypted data (`data_store`, `data_fetch`, `data_list`, `data_search`), wallet context (`context_shielded`, `context_public`, `context_full`), stealth-x402 payments (`x402_payer_info`, `pay_x402`), and `wallet_status`
- AES-256-GCM with AAD-bound metadata (`{kind, version}`) — server stores ciphertext only
- 32-byte master key generated in your browser at `https://app.veiledhood.to` (Agent tab), wrapped with your passphrase via PBKDF2-SHA256 (600k iters), stored as opaque envelope by Veiledhood
- stdio transport (works in every major MCP client today); HTTP+SSE deferred to v0.2

---

## Prerequisites

1. **Node ≥ 22.** Native WebCrypto is required for the master-key file loader.
2. **A funded Veiledhood shielded-USDC balance** — get one at `https://app.veiledhood.to` (Deposit tab).
3. **Two files in `~/.veiledhood/`** — see *Initial setup* below.

## Initial setup — one-time

1. Open `https://app.veiledhood.to`, connect your EVM wallet, sign the SIWE login message.
2. Click the **Agent** tab.
3. Enter a passphrase (≥8 chars; **lose this and you lose your encrypted agents**).
4. Click **Generate & download**. Two files download:
   - `session.json` — short-lived JWT + your wallet address + API base URL
   - `master.key` — your 32-byte AES master key (base64-wrapped JSON)
5. Move both files into `~/.veiledhood/`. On macOS/Linux also `chmod 600` both files.

```bash
# macOS / Linux
mkdir -p ~/.veiledhood
mv ~/Downloads/session.json ~/.veiledhood/session.json
mv ~/Downloads/master.key ~/.veiledhood/master.key
chmod 600 ~/.veiledhood/session.json ~/.veiledhood/master.key
```

```cmd
REM Windows (cmd.exe)
mkdir %USERPROFILE%\.veiledhood 2>nul
move /Y "%USERPROFILE%\Downloads\session.json" "%USERPROFILE%\.veiledhood\session.json"
move /Y "%USERPROFILE%\Downloads\master.key"   "%USERPROFILE%\.veiledhood\master.key"
```

If the MCP server complains the files are world-readable (POSIX only), tighten them with `chmod 600`. Windows uses ACLs — the file is already only readable by your user account by default.

> **JWT expiry.** `session.json` is valid for 7 days. When it expires the tools start returning `VEILEDHOOD_REAUTH_REQUIRED` — reopen the Agent tab and re-download just `session.json` (your `master.key` does not change unless you reset on the dApp).

---

## Install in your MCP client

Pick the one(s) you use. The server is the same binary; only the client wiring changes.

> **Pre-publish / local dev:** until `@veiledhood/mcp-server` ships on npm, swap `npx -y @veiledhood/mcp-server` for `node /absolute/path/to/packages/mcp-server/bin/veiledhood-mcp.js` in every snippet below.

### Claude Code

```bash
# From any directory — registers the server globally for your user
claude mcp add veiledhood --scope user -- npx -y @veiledhood/mcp-server

# Or, while building locally from this monorepo:
claude mcp add veiledhood --scope user -- node /absolute/path/to/packages/mcp-server/bin/veiledhood-mcp.js
```

Verify with `claude mcp list` — you should see `veiledhood: ✓ Connected`.

### Claude Desktop

Edit `claude_desktop_config.json`:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "veiledhood": {
      "command": "npx",
      "args": ["-y", "@veiledhood/mcp-server"]
    }
  }
}
```

If `npx` isn't on Claude Desktop's PATH (common on macOS), use the absolute node path instead:

```json
{
  "mcpServers": {
    "veiledhood": {
      "command": "/usr/local/bin/node",
      "args": ["/absolute/path/to/packages/mcp-server/bin/veiledhood-mcp.js"]
    }
  }
}
```

Restart Claude Desktop. The 🔌 icon at the bottom of any chat shows registered MCP servers.

### Cursor

Global (applies to every workspace): `~/.cursor/mcp.json`
Per-project (overrides global for that repo): `.cursor/mcp.json` in the repo root.

```json
{
  "mcpServers": {
    "veiledhood": {
      "command": "npx",
      "args": ["-y", "@veiledhood/mcp-server"]
    }
  }
}
```

Toggle the server on under **Settings → Cursor Settings → MCP**.

### Continue

Continue (VS Code / JetBrains) uses standalone YAML blocks per server. Create `.continue/mcpServers/veiledhood.yaml` in your home or project root:

```yaml
name: Veiledhood MCP
version: 0.1.0
schema: v1
mcpServers:
  - name: veiledhood
    type: stdio
    command: npx
    args:
      - "-y"
      - "@veiledhood/mcp-server"
```

MCP tools are only usable in Continue's **agent** mode (not chat or edit). Switch with the mode selector at the bottom of the input box.

### Cline (VS Code extension)

Easiest: in the Cline panel, click the **MCP Servers** icon (stacked-server icon) → **Configure** tab → **Configure MCP Servers**. The opened JSON file is the one you want.

If you prefer to edit by hand, the path is:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| Windows | `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json` |
| Linux | `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |

```json
{
  "mcpServers": {
    "veiledhood": {
      "command": "npx",
      "args": ["-y", "@veiledhood/mcp-server"]
    }
  }
}
```

---

## Optional — install the Claude Code skills

Two skills ship in this repo. Both are optional; install whichever match your use case (or both — they don't conflict).

- **`skills/veiledhood-agent/SKILL.md`** — auto-activates on agent / DCA / rebalance / yield / portfolio phrasing. Maps natural-language strategy descriptions to the right `agent_*` / `context_*` tool call.
- **`skills/veiledhood-research/SKILL.md`** — auto-activates on research / lab notebook / dataset / draft / grant / encrypted-note phrasing. Maps DeSci workflows to the `data_*` tools (including `data_search` with the tag conventions documented under *DeSci patterns* below).

```bash
# macOS / Linux
mkdir -p ~/.claude/skills/veiledhood-agent ~/.claude/skills/veiledhood-research
cp skills/veiledhood-agent/SKILL.md    ~/.claude/skills/veiledhood-agent/SKILL.md
cp skills/veiledhood-research/SKILL.md ~/.claude/skills/veiledhood-research/SKILL.md
```

```powershell
# Windows (PowerShell)
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.claude\skills\veiledhood-agent"    | Out-Null
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.claude\skills\veiledhood-research" | Out-Null
Copy-Item skills\veiledhood-agent\SKILL.md    "$env:USERPROFILE\.claude\skills\veiledhood-agent\SKILL.md"
Copy-Item skills\veiledhood-research\SKILL.md "$env:USERPROFILE\.claude\skills\veiledhood-research\SKILL.md"
```

Restart Claude Code. The skills auto-activate independently.

---

## Tools

Tool names and shapes are the same in every client. See `skills/veiledhood-agent/SKILL.md` and `skills/veiledhood-research/SKILL.md` for natural-language → tool-call mapping.

### Agents (encrypted on-chain strategies)

| Tool | Shape (Zod) | Notes |
|---|---|---|
| `agent_create` | `{ kind: "dca" \| "rebalance" \| "yield", params: object }` | Encrypts `params` locally with AAD `{kind, version}`. |
| `agent_list` | `{}` | Returns metadata only — no `params`. |
| `agent_get` | `{ id: string }` | Decrypts `params` locally; returned to the agent process only. |
| `agent_update` | `{ id: string, status?: "active" \| "paused", params?: object }` | At least one of `status` or `params` is required. Re-encrypts with the existing `kind`. |
| `agent_delete` | `{ id: string }` | Soft delete. |
| `agent_run` | `{ id: string }` | Bumps `lastRunAt` and returns decrypted `params`. |

### Encrypted data (generic blob vault — kind=data)

| Tool | Shape (Zod) | Notes |
|---|---|---|
| `data_store` | `{ label: string, data: string, tags?: string[] }` | Encrypts `{label, data, tags, savedAt}` locally with AAD `{kind:"data", version:1}`. `tags` is optional, ≤32 entries, ≤64 chars each. Max 1 MB ciphertext (~750 KB plaintext). |
| `data_fetch` | `{ id: string }` | Decrypts locally; returns `{id, label, data, tags, savedAt}`. |
| `data_list` | `{}` | Returns ids + timestamps only. Labels stay encrypted. |
| `data_search` | `{ tags: string[], matchAll?: boolean }` | Client-side tag filter. Fetches every kind=data record, decrypts each, returns matches. O(n) — fine up to ~100s of records. `matchAll` defaults to `true` (AND-match); pass `false` for OR-match. Empty `tags` returns every record with its label surfaced. |

### Wallet context (k-anon via pooled RPC)

| Tool | Shape (Zod) | Notes |
|---|---|---|
| `context_shielded` | `{ chainId?: number }` | Shielded Veiledhood balances + USD. Default Base. |
| `context_public` | `{ chainId?: number }` | Public on-chain balances. Routed through pooled-RPC proxy — RPC sees a cohort, not your address. |
| `context_full` | `{ chainId?: number }` | Combined shielded + public + USD totals. |

### Stealth-x402 payments (outbound)

| Tool | Shape (Zod) | Notes |
|---|---|---|
| `x402_payer_info` | `{}` | Returns the deterministic Base EOA derived from your `master.key` via HKDF. Fund it with USDC once; same address every session. No on-chain read — privacy-preserving. |
| `pay_x402` | `{ url: string, method?, body?, headers?, maxUsd?, failOnHttpError? }` | Fetch any URL. On `402 Payment Required`, sign an EIP-3009 USDC authorization from your derived payer EOA (via `@shroud-fi/x402`), retry with `X-PAYMENT`, return the unlocked body + on-chain settle tx hash. `maxUsd` is a hard safety cap (default $0.10). Receivers that use ShroudFi (e.g. Veiledhood's `/ai/chat`) settle the payment to a **fresh stealth address per call** so the payment graph stays unlinkable. |

### Session

| Tool | Shape (Zod) | Notes |
|---|---|---|
| `wallet_status` | `{}` | Confirms session + backend reachability. |

---

## Cookbook — natural-language prompts

Drop these into Claude Code / Desktop / Cursor / Continue / Cline. The veiledhood skills (see *Optional skills* above) teach the LLM to map each prompt to the right tool call without you writing JSON.

1. **"Set up a weekly $50 USDC DCA into ETH."** → `agent_create({kind:"dca", params:{fromAsset:"USDC", toAsset:"ETH", amountPerRun:"50", cadence:"weekly", maxSlippageBps:50}})`
2. **"What's in my wallet?"** → `context_full({})` — returns shielded Veiledhood + public Base balances + USD totals in one shot.
3. **"Save this experiment log under tags `protein-folding` and `2026-q2`."** → `data_store({label:"experiment-log-…", data:"<your text>", tags:["protein-folding","2026-q2"]})`
4. **"Find all my drafts tagged `grant` and `nih`."** → `data_search({tags:["grant","nih"], matchAll:true})`
5. **"Pause my yield bot."** → `agent_list({})` → find `kind:"yield"` + `status:"active"` → `agent_update({id, status:"paused"})`

---

## DeSci patterns — research workflows on encrypted data

The `data_store` / `data_fetch` / `data_list` / `data_search` quartet is a generic encrypted-blob vault — useful for any private document, but specifically designed to support **decentralized science (DeSci)** workflows where researchers want to store lab notebook entries, draft manuscripts, dataset manifests, and grant text on chain-adjacent infrastructure without exposing plaintext to Veiledhood or to LLM providers.

Below are five patterns with suggested labels + tag conventions. None of these are special-cased in the protocol — they are conventions that play nicely with `data_search`.

### 1. Lab notebook entry

```jsonc
data_store({
  label: "lab-notes-2026-06-03-trial-04",
  data: "Trial 4: increased temperature to 37°C. Yield improved 12%…",
  tags: ["lab-notes", "protein-folding", "2026-q2"]
})
```

Then `data_search({tags:["lab-notes","protein-folding"]})` returns every notebook entry on that project.

### 2. Peer-review draft

```jsonc
data_store({
  label: "review-nature-machine-intel-2026-submission-42",
  data: "Reviewer 2 comments: the methodology section needs clarification on…",
  tags: ["peer-review", "draft", "confidential"]
})
```

The `confidential` tag is a convention — `data_search({tags:["confidential"]})` lets you sweep every draft you've marked sensitive before sharing a workstation.

### 3. Dataset manifest

```jsonc
data_store({
  label: "dataset-manifest-zebrafish-imaging-2026",
  data: JSON.stringify({
    name: "zebrafish-imaging-2026",
    fileCount: 12_400,
    sha256: "ab12cd34…",
    s3: "s3://lab-bucket/zebrafish-2026/",
    schema: ["timestamp", "well_id", "channel", "z_slice"]
  }),
  tags: ["dataset", "imaging", "zebrafish"]
})
```

Veiledhood stores the manifest (with provenance + checksum), not the raw 12k files. Large blobs stay on your storage of choice (S3 / IPFS / lab NAS) — Veiledhood is the encrypted *index*.

### 4. IRB protocol / grant compliance text

```jsonc
data_store({
  label: "irb-protocol-v3-2026-06-01",
  data: "Section 4.2 (data handling): all participant identifiers replaced with…",
  tags: ["irb", "compliance", "v3"]
})
```

`data_search({tags:["irb"]})` returns every version. Pair with the `label`'s ISO date to find the latest.

### 5. Grant text drafts

```jsonc
data_store({
  label: "nih-r01-aims-section-draft-3",
  data: "Specific Aim 1: characterize the binding affinity of…",
  tags: ["grant", "nih", "r01", "draft"]
})
```

`data_search({tags:["grant","draft"], matchAll:true})` shows in-flight drafts across every grant.

### Privacy properties (the part you're paying for)

- Veiledhood's API stores only ciphertext + IV + `kind="data"` + timestamps. **Tags are inside the ciphertext** — the server cannot filter on them, which is why `data_search` is client-side. The server cannot enumerate which researcher works on which topic.
- The LLM provider sees the tool calls (label + data + tags pass through as inputs), but the encrypted-data blobs are never sent to the LLM unless you ask. Use the skill's privacy hygiene rules (don't paste secrets back into chat).
- Tags are stored lowercased internally for case-insensitive matching. Pick short, conventional strings (`protein-folding`, not `Protein Folding Research Q2`).

---

## Troubleshooting

| Error code | Meaning | Fix |
|---|---|---|
| `VEILEDHOOD_SESSION_MISSING` | `~/.veiledhood/session.json` not found | Run the Agent-tab setup. |
| `VEILEDHOOD_SESSION_MALFORMED` | Bad JSON or missing required fields | Re-download `session.json`. |
| `VEILEDHOOD_REAUTH_REQUIRED` | JWT expired (server returned 401) | Re-download `session.json` from the Agent tab. |
| `VEILEDHOOD_MASTER_KEY_MISSING` | `~/.veiledhood/master.key` not found | Re-download `master.key`. |
| `VEILEDHOOD_MASTER_KEY_MALFORMED` | Wrong shape (must be base64 of exactly 32 bytes inside the JSON) | Re-download `master.key`. |
| `VEILEDHOOD_DECRYPT_FAILED` | Master key doesn't match this agent's ciphertext | Confirm you're using the master.key for the same wallet that created the agent. |
| `VEILEDHOOD_API_RATE_LIMITED` | Hit the per-user rate limit | Wait the seconds in `Retry-After`. |
| `VEILEDHOOD_API_NOT_FOUND` | Agent id doesn't exist (or was soft-deleted) | `agent_list` to see current ids. |

If the MCP server logs `world-readable` warnings on stderr for `~/.veiledhood/*`, tighten file perms (`chmod 600` on POSIX). v0.1 only warns; v0.2 will hard-fail.

---

## Threat model

- **Veiledhood servers:** can see ciphertext + IV + `kind` + lifecycle timestamps. Cannot read `params`. Cannot derive your master key from the wrapped envelope without your passphrase.
- **The LLM provider (Anthropic / OpenAI / etc.):** sees the **names of the tools** you call and any plain text you put in chat. The MCP server passes decrypted `params` back as tool results — the LLM sees those. Don't dump strategy plaintext into the chat scrollback if you want to keep it private from the provider.
- **Network observers between you and `api.veiledhood.to`:** TLS protects everything in transit. The wire shape (ciphertext + IV + iterations) is opaque.
- **Wallet compromise:** an attacker with your wallet can re-authenticate, but **cannot decrypt your existing agents** without `master.key`.
- **`master.key` compromise:** an attacker with both `master.key` and access to your JWT can decrypt all your agents. Keep `master.key` offline-backed-up; rotate by re-running Generate on the Agent tab (replaces the envelope and invalidates the old key).

## License

MIT
