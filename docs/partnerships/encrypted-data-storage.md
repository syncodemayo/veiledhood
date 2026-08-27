# Encrypted Data Storage on Veiledhood

Encrypt any user data on-device. Veiledhood stores ciphertext only.

- **Package:** [`@veiledhood/agent-crypto`](https://www.npmjs.com/package/@veiledhood/agent-crypto) (Node ≥ 22, browser-compatible via WebCrypto)
- **MCP server:** [`@veiledhood/mcp-server`](https://www.npmjs.com/package/@veiledhood/mcp-server) — three tools: `data_store`, `data_fetch`, `data_list`
- **Primitives:** AES-256-GCM (encryption) + PBKDF2-SHA256 (passphrase wrap) + HKDF-SHA256 (per-context key derivation)
- **License:** MIT

---

## Who this is for

Anyone with user data they don't want to hold in plaintext:

- **Confidential documents** — legal filings, internal reports, M&A memos
- **Personal records** — medical history, financial statements, tax returns
- **Research datasets** — clinical, genomic, behavioral
- **Newsroom material** — sources, drafts, interview transcripts
- **App-level secrets** — API keys, OAuth tokens, recovery codes
- **Agent strategy configs** — trading bots, automation rules

If your threat model includes "what happens when our database is breached" — this primitive answers it. You only store ciphertext. The decryption key never reaches your servers.

---

## Two ways to use it

### Option A — Direct library (`@veiledhood/agent-crypto`)

You own the encryption and the backend. Use the library in your own product:

- User picks a passphrase
- You generate a 32-byte master key in the browser
- Wrap it with the passphrase, send the opaque envelope to your backend
- Encrypt each data blob on-device, send the opaque ciphertext to your backend
- Server cannot decrypt — only the user can

### Option B — Veiledhood-hosted storage (MCP server)

Veiledhood hosts the storage. You install the MCP server in any compatible client (Claude Code, Claude Desktop, Cursor, Continue, Cline):

- `data_store({ label, data })` — encrypts client-side, ships ciphertext to `api.veiledhood.to`
- `data_fetch({ id })` — fetches + decrypts client-side
- `data_list()` — lists ids + timestamps (labels stay encrypted)

Choose A if you already have a backend. Choose B if you want zero infra and immediate distribution to MCP-enabled agents.

---

## Architecture (Option A)

```
┌──────────────────────────────────────────────────────────────┐
│ User device (browser or local agent runtime)                 │
│                                                              │
│   1. K = crypto.getRandomValues(32)        ← one-time        │
│   2. envelope = wrapMasterKey(K, passphrase)                 │
│   3. POST envelope to your backend         ── ciphertext ──► │
│                                                              │
│   For each blob:                                             │
│   4. dataKey = deriveAgentKey(K, blobId, kind)               │
│   5. ct = encrypt(dataKey, JSON.stringify(payload), aad)     │
│   6. POST { blobId, kind, ct } to your backend  ── ct ────►  │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ Your backend                                                 │
│                                                              │
│   - Store envelope (opaque blob, 1 per user)                 │
│   - Store {blobId, kind, ct} (opaque, N per user)            │
│   - You CANNOT decrypt either. Only the user can.            │
└──────────────────────────────────────────────────────────────┘
```

---

## Install (Option A)

```bash
npm install @veiledhood/agent-crypto
# or
pnpm add @veiledhood/agent-crypto
```

Works in browsers (ESM) and Node ≥ 22. No polyfills required.

---

## Step 1 — bootstrap a master key (once per user)

```ts
import { generateMasterKey, wrapMasterKey } from "@veiledhood/agent-crypto";

async function onboardUser(passphrase: string) {
  const masterKey = generateMasterKey();
  const envelope = await wrapMasterKey(masterKey, passphrase);
  // envelope = { salt, iv, ct, iterations, version } — all base64 strings

  await fetch("/api/users/me/envelope", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  });

  return masterKey; // hold in memory; DO NOT persist
}
```

The envelope is the only persistent form of the key. The raw bytes never touch storage.

---

## Step 2 — encrypt a blob

```ts
import { deriveAgentKey, encrypt } from "@veiledhood/agent-crypto";

async function storeBlob(
  masterKey: Uint8Array,
  blobId: string,    // your id — ULID, UUID, hash, anything
  kind: string,      // "document" | "image" | "config" | ...
  payload: object,   // any JSON-serializable thing
) {
  const dataKey = await deriveAgentKey(masterKey, blobId, kind);
  const aad = blobId; // must match on decrypt
  const ct = await encrypt(dataKey, JSON.stringify(payload), aad);
  // ct = { iv, ct, version } — base64 strings

  await fetch("/api/blobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blobId, kind, ...ct }),
  });
}
```

`kind` is mixed into HKDF so different kinds get distinct keys. `aad` binds the ciphertext to a context string so a swapped/replayed blob fails to decrypt.

---

## Step 3 — decrypt a blob

```ts
import { unwrapMasterKey, deriveAgentKey, decryptString } from "@veiledhood/agent-crypto";

async function loadBlob(passphrase: string, blobId: string) {
  const envelope = await fetch("/api/users/me/envelope").then((r) => r.json());
  const masterKey = await unwrapMasterKey(envelope, passphrase);

  const row = await fetch(`/api/blobs/${blobId}`).then((r) => r.json());

  const dataKey = await deriveAgentKey(masterKey, blobId, row.kind);
  const aad = blobId;
  const json = await decryptString(
    dataKey,
    { iv: row.iv, ct: row.ct, version: row.version },
    aad,
  );
  return JSON.parse(json);
}
```

Decrypted payload lives only in the user's process memory.

---

## Encrypting a file (binary)

`@veiledhood/agent-crypto` encrypts `Uint8Array | string`. For files:

```ts
async function storeFile(masterKey: Uint8Array, blobId: string, file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dataKey = await deriveAgentKey(masterKey, blobId, "file");
  const ct = await encrypt(dataKey, bytes, blobId);

  await fetch("/api/blobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blobId,
      kind: "file",
      filename: bytesToBase64(new TextEncoder().encode(file.name)), // optional, encrypt this too if metadata matters
      ...ct,
    }),
  });
}
```

Decrypt path is symmetric — `decrypt()` returns a `Uint8Array` you can hand to `new Blob([bytes])` for download.

---

## Option B — Use Veiledhood's hosted MCP server

If you don't want to run a backend, point any MCP-compatible client at `@veiledhood/mcp-server` and use the three data tools directly.

### Install

```bash
npx -y @veiledhood/mcp-server
```

Add to your MCP client config (Claude Code shown — same shape for Cursor / Desktop / etc.):

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

Bootstrap a master key once at https://app.veiledhood.to/mcp — saves `session.json` + `master.key` to `~/.veiledhood/`.

### Usage (natural language inside any MCP-aware client)

```
You: Store this encrypted on Veiledhood — label "tax-2024", contents: { income: 50000, deductions: ... }
Agent: [calls data_store(label="tax-2024", data="...")]
       Stored encrypted data <id>. Payload encrypted locally; Veiledhood stores ciphertext only.

You: What's in my Veiledhood vault?
Agent: [calls data_list()] 3 encrypted blob(s) (labels encrypted — call data_fetch to decrypt):
       - <id-1> created=... updated=...
       - <id-2> created=... updated=...

You: Fetch blob <id-1>
Agent: [calls data_fetch(id="...")] { label: "tax-2024", data: "...", savedAt: "..." }
```

### Caps (server-enforced)

| Limit | Default | Tunable per deployment |
|---|---|---|
| Max ciphertext size per blob | 1 MB | `DATA_MAX_CIPHERTEXT_BYTES` |
| Max blobs per user | 100 | `DATA_MAX_PER_USER` |
| CRUD rate limit | 30 req/min | `AGENTS_RATE_LIMIT_PER_USER_PER_MIN` |

Base64 inflates plaintext by ~33%, so the practical plaintext ceiling is ~750 KB per blob.

---

## What Veiledhood stores

| Object | Shape | Cardinality |
|---|---|---|
| Envelope | `{ salt, iv, ct, iterations, version }` (~150 bytes) | 1 per user |
| Blob | `{ id, kind: "data", iv, ct, version, status, createdAt, updatedAt }` (~200 bytes + payload) | N per user |

All opaque. No field reveals payload intent. `label` is encrypted inside the ciphertext, not stored as a separate column.

---

## Security notes

- **Master key never leaves the user device.** Hold in process memory; never persist to `localStorage` or cookies. The envelope is the persistent form.
- **AES-GCM nonces are random** (96-bit, fresh per encrypt). Replay attacks are mathematically prevented.
- **PBKDF2 iterations** default to 600k — OWASP 2023 recommendation. Tune higher via `wrapMasterKey(masterKey, passphrase, 1_000_000)`.
- **AAD mismatch on decrypt throws** — same primitive that catches tampering also catches AAD-substitution attacks.
- **Tampered ciphertext** throws `OperationError`. Handle it; don't ignore.
- **Forgotten passphrase = unrecoverable data.** By design. Encourage users to store the passphrase in a password manager.

---

## What this primitive does NOT do

- **Network privacy / Tor** — encryption hides *what*; if you also want to hide *who*, use Veiledhood's other surfaces.
- **Authentication** — out of scope. Use JWT, SIWE, OAuth, whatever you already have.
- **Sharing between users** — v1 is single-user. Multi-recipient key wrap is on the roadmap.
- **Server-side search** — server is blind. Build indexes client-side or store searchable metadata in a separate encrypted blob.

---

## Round-trip test (recommended in CI)

```ts
import {
  generateMasterKey,
  deriveAgentKey,
  encrypt,
  decryptString,
} from "@veiledhood/agent-crypto";

const masterKey = generateMasterKey();
const dataKey = await deriveAgentKey(masterKey, "blob-1", "document");
const aad = "blob-1";
const ct = await encrypt(dataKey, JSON.stringify({ hello: "world" }), aad);
const out = await decryptString(dataKey, ct, aad);
console.assert(JSON.parse(out).hello === "world", "round-trip failed");
```

---

## Support

- **Integration questions / bug reports:** your usual partnership contact
- **Security disclosure:** security@veiledhood.to (PGP key on request)

---

## Versioning

Both packages follow semver. Pin to a minor version (`^0.1.0` / `^0.3.0`) for patch-only updates. We do not break the ciphertext format within a major version.

---

*Last updated: 2026-05-31*
