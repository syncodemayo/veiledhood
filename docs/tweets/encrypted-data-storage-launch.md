# Tweet thread — Encrypted Data Storage launch

Drafted 2026-05-31. Goal: announce that Veiledhood's encryption primitive is now general-purpose, not just for agent strategies. Position as "encrypted backend you can drop in to anything."

Don't post until: (a) PR merged + mcp-server@0.3.0 published, (b) /docs/partnerships/encrypted-data-storage.md published or linked from a public URL.

---

## Option A — single tweet (announcement)

> Veiledhood now encrypts more than agent strategies.
>
> `data_store`, `data_fetch`, `data_list` — three new MCP tools that put any blob (document, dataset, config, file) behind AES-256-GCM with your master key.
>
> The server never sees plaintext. You hold the only decryption path.
>
> `npm i -g @veiledhood/mcp-server@0.3.0`

Length check: ~270 chars. Single tweet.

---

## Option B — 4-tweet thread (technical)

**1/4**

> Shipped: encrypted data storage on Veiledhood.
>
> Any blob — file, dataset, config, recovery codes, contract draft — encrypted on your device, ciphertext shipped to the server, decryption key never leaves your machine.
>
> Powered by `@veiledhood/agent-crypto` (open source, MIT).

**2/4**

> Three new MCP tools in `@veiledhood/mcp-server@0.3.0`:
>
> • `data_store({ label, data })` — encrypt + ship
> • `data_fetch({ id })` — fetch + decrypt
> • `data_list()` — list ids (labels stay encrypted)
>
> Works in Claude Code, Claude Desktop, Cursor, Continue, Cline.

**3/4**

> Stack: AES-256-GCM + PBKDF2-SHA256 (passphrase wrap) + HKDF-SHA256 (per-blob key derivation).
>
> No custom crypto. Native WebCrypto. PBKDF2 at OWASP 2023 iteration count.
>
> Same primitive Bloom can drop into their agent runtime. Same primitive any DeSci protocol can use for clinical data.

**4/4**

> Install:
>
> `npm i -g @veiledhood/mcp-server`
>
> Bootstrap a key at app.veiledhood.to/mcp.
>
> Then ask any MCP-aware agent: "store this encrypted on Veiledhood."
>
> Docs: <link to encrypted-data-storage.md once public>

---

## Option C — DeSci-angle thread (separate audience)

**1/3**

> Researchers — your clinical, genomic, behavioral data shouldn't sit in plaintext.
>
> Veiledhood now hosts encrypted data storage as a primitive. Your dataset never touches our servers in readable form. We can't decrypt it. Subpoenas can't decrypt it.

**2/3**

> Three MCP tools. Drop them into any AI agent (Claude Code, Cursor, Continue) and your agent can store + retrieve encrypted research data without giving us the key.
>
> `data_store`, `data_fetch`, `data_list`.

**3/3**

> Free for the first 100 blobs per user. Each blob up to 1 MB.
>
> Open-source library if you want to host the storage yourself: `@veiledhood/agent-crypto`.
>
> Docs: <link>

---

## Hashtags to consider

- `#privacy` (generic, broad)
- `#encryption` (generic)
- `#MCP` (small but engaged dev audience)
- `#DeSci` (vertical pull — use in Option C thread only)
- `#AIagents` (broad — use sparingly)

Skip cryptocurrency-specific tags (#DeFi, #web3) for this announcement — the pitch is broader than that.

---

## Reply / amplification plan

- Reply with the install snippet under the main tweet
- Quote-tweet 24h later highlighting one use case (Option C content can be the quote-tweet)
- DM 3-5 DeSci protocol founders with the partner doc link
- Pin the thread on the @Veiledhood_ profile for the launch week

---

## Decision needed before posting

| Question | Suggestion |
|---|---|
| Single tweet or full thread? | Option B (4-tweet) — best balance of reach + clarity |
| Schedule? | 14:00 UTC weekday (max US morning + EU afternoon overlap) |
| Pin? | Yes, for 7 days |
| Quote-retweet from team accounts? | Yes if any team handle exists; otherwise leave to organic |
| Crosspost? | Mirror to Discord announcements + Farcaster (same copy) |
