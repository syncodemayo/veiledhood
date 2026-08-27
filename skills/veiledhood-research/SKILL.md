---
name: veiledhood-research
description: Use whenever the user wants to save, search, or recall research material — lab notebook entries, dataset manifests, manuscript drafts, peer-review notes, IRB protocols, grant text, or any other private document — into Veiledhood's encrypted data vault. Maps natural-language phrasing like "save this experiment log", "find my genomics notes", "list my drafts", "search my notes tagged grant nih" to the right `data_*` MCP tool call so the user never has to write JSON. Required reading before invoking any `veiledhood.data_*` tool. Pair with `veiledhood-agent` for users who do both DeFi strategies and research.
---

# Veiledhood research / DeSci skill

The user has the `veiledhood` MCP server installed (stdio, `node …/packages/mcp-server/bin/veiledhood-mcp.js` or `npx @veiledhood/mcp-server`). This skill is the natural-language → tool-call mapping for the *encrypted data vault* subset (`kind="data"` records). For DeFi strategies, defer to the companion `veiledhood-agent` skill.

**Privacy invariant — the part the user is paying for:** every record stored via `data_store` is AES-256-GCM encrypted on the user's machine with a master key Veiledhood does not have. The Veiledhood backend stores only ciphertext + IV + a `kind="data"` discriminator + timestamps. **Tags are encrypted alongside the payload**, so the server cannot enumerate which user works on which topic. The LLM provider (you, Claude) only sees tool inputs and outputs — never the master key, never the JWT. When `data_fetch` / `data_search` decrypts, the plaintext is in *this* process only — don't echo full payloads back to the user unless they ask.

## Tools (data subset)

| Tool | When to call | Returns |
|---|---|---|
| `wallet_status` | "am I connected", "is my session OK" | `{address, exp, backend: "ok" \| "unreachable"}` |
| `data_store` | "save this", "store this note", "encrypt this for me", "add to my vault" | `{agentId, createdAt}` — `agentId` is the record id |
| `data_fetch` | "recall the X note", "show me record <id>", "what did I save as X" — when the user names a specific record | `{id, label, data, tags, savedAt}` |
| `data_list` | "list my notes", "what do I have stored", "show all my records" | id + timestamps for every kind=data record (labels stay encrypted) |
| `data_search` | "find my notes tagged X", "show drafts tagged grant", "search for confidential" | matched `{id, label, tags, savedAt}` — labels surfaced because we decrypted client-side |

## When to use `data_search` vs `data_list`

- **`data_list`** is fast (one HTTP call, no decryption). Use it when the user wants a count or just wants to see "do I have anything stored".
- **`data_search`** decrypts every kind=data record locally. Use it whenever the user mentions a topic, project name, or filter ("find my zebrafish notes", "show grant drafts"). Cost scales with record count — usually fine at <100 records.

If the user lists nothing yet (`data_list` returns empty), don't bother calling `data_search`.

## Tag conventions

Tags are arbitrary lowercase strings the user supplies. The MCP server stores them inside the encrypted payload; `data_search` matches them case-insensitively.

Recommended conventions (apply unless the user specifies otherwise):

- **Project name** as a kebab-case tag: `protein-folding`, `zebrafish-imaging`, `nih-r01`
- **Document kind**: `lab-notes`, `draft`, `peer-review`, `grant`, `dataset`, `irb`, `meeting-notes`
- **Time bucket**: `2026-q2`, `2026-06` (ISO year-quarter or year-month)
- **Sensitivity marker**: `confidential` (treat as a hot tag — used to sweep before sharing screens)

If the user gives you a free-form phrase like "save this under my Q2 protein-folding research", split it into multiple tags: `["protein-folding", "2026-q2"]` rather than `["q2-protein-folding-research"]`. Better recall.

If unclear, ask once: "Any tags you want on this? (project, kind, time bucket — I'll default to none.)"

## Five research patterns and how to map them

### Lab notebook entry

User says: "Save this experiment log. Trial 4, protein folding project, Q2."

```js
data_store({
  label: "lab-notes-2026-06-03-trial-04",
  data: "<the experiment log text>",
  tags: ["lab-notes", "protein-folding", "2026-q2"]
})
```

Confirm with: "Saved lab-notes-2026-06-03-trial-04 (id `…`). Tagged lab-notes, protein-folding, 2026-q2."

### Peer-review draft

User: "Store my reviewer comments for the Nature MI submission, confidential."

```js
data_store({
  label: "review-nature-mi-2026-submission-42",
  data: "<comments>",
  tags: ["peer-review", "draft", "confidential"]
})
```

### Dataset manifest

User: "Save a manifest for the zebrafish imaging set — 12,400 files, S3 path, sha256 included."

```js
data_store({
  label: "dataset-manifest-zebrafish-imaging-2026",
  data: JSON.stringify({ name, fileCount, sha256, s3, schema }),
  tags: ["dataset", "imaging", "zebrafish"]
})
```

If the user gives the manifest as structured fields rather than a JSON blob, stringify it yourself before storing. The vault is opaque to Veiledhood but the LLM needs structured input.

### IRB protocol / compliance text

User: "Save the v3 IRB protocol from June 1."

```js
data_store({
  label: "irb-protocol-v3-2026-06-01",
  data: "<protocol text>",
  tags: ["irb", "compliance", "v3"]
})
```

### Grant text drafts

User: "Drop the Aim 1 draft for the NIH R01 in my vault."

```js
data_store({
  label: "nih-r01-aims-section-draft-3",
  data: "<draft text>",
  tags: ["grant", "nih", "r01", "draft"]
})
```

## Search workflows

| User says | Tool call |
|---|---|
| "Find my protein folding notes" | `data_search({tags:["protein-folding"]})` |
| "Show all my drafts" | `data_search({tags:["draft"]})` |
| "Find my grant drafts for NIH" | `data_search({tags:["grant","nih","draft"], matchAll:true})` |
| "Anything tagged grant OR dataset?" | `data_search({tags:["grant","dataset"], matchAll:false})` |
| "Sweep everything marked confidential" | `data_search({tags:["confidential"]})` |
| "Just list everything" | `data_list({})` then optionally `data_search({tags:[]})` if the user wants labels surfaced |

## Recall + edit workflow

Encrypted records are immutable in the current API (`data_*` doesn't expose an update path — that's reserved for `agent_*`). If the user wants to "update" a record:

1. `data_fetch({id})` to retrieve the original.
2. Modify the `data` string in working memory.
3. `data_store({label, data, tags})` with a new label (e.g., `…-v2` or `…-2026-06-03`).
4. Optionally tell the user "the previous version is still in your vault at id `…` — call `data_search` to find it later".

Soft-delete via `agent_delete({id})` works for `kind="data"` records too — they share the underlying schema. Confirm before deleting.

## Privacy hygiene

- **Don't echo full record contents back to the user unprompted.** Confirm with `id`, `label`, and tag list — let them ask if they want the body.
- **Never log or echo the JWT, master.key bytes, iv, or raw ciphertext.**
- **`data_search` decrypts in your process.** Once you have the matching list, drop the decrypted payloads from working memory before responding — keep ids/labels/tags only.
- **If the user pastes their master.key into chat (mistake):** warn them, tell them to rotate via the dApp's Agent tab, and refuse to act on it.
- **Confidentiality sweep:** if the user says "before I share my screen, what's sensitive", run `data_search({tags:["confidential"]})` and report the count + labels but not the bodies.

## Errors

Same structured error codes as the agent skill. Common to data flows:

| Code | Meaning | What to tell the user |
|---|---|---|
| `VEILEDHOOD_REAUTH_REQUIRED` | JWT expired | "Your Veiledhood session has expired. Open `https://app.veiledhood.to`, connect your wallet, click the **Agent** tab, and re-download `session.json` into `~/.veiledhood/`." |
| `VEILEDHOOD_MASTER_KEY_MISSING` | `~/.veiledhood/master.key` not found | "The MCP server can't find your master key. Re-download `master.key` from the Agent tab." |
| `VEILEDHOOD_DECRYPT_FAILED` | Wrong master key or tampered ciphertext | "Decryption failed — your master.key may not match this record. Check you're using the master.key for the same wallet that stored it." |
| `VEILEDHOOD_VALIDATION_ERROR` (with "exceeds max size") | Payload >1 MB ciphertext (~750 KB plaintext) | "That payload is too large for a single record. Split it into multiple records or store the heavy bytes elsewhere (S3, IPFS, lab NAS) and save a manifest pointing to them." |
| `VEILEDHOOD_API_NOT_FOUND` | Id doesn't exist or was deleted | "No record with that id — `data_list` to see current records." |

## Quick smoke

To prove the connection without modifying anything:

1. `wallet_status` — should report `address: 0x…` + `backend: "ok"`.
2. `data_list` — empty array is fine.

If `wallet_status` returns `VEILEDHOOD_REAUTH_REQUIRED`, walk the user through the dApp recovery flow above.

## Don't surface to the user

- The fact that `data_search` is O(n) on record count. Just call it.
- The fact that tags are stored lowercased. Match the user's casing in the confirmation message; only the underlying matcher cares.
- The `kind="data"` discriminator. It's an implementation detail.
