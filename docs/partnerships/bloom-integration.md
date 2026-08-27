# `@veiledhood/agent-crypto` — Partner Integration Guide

Encrypt user strategy configs on-device so your backend only stores ciphertext.

- **Package:** [`@veiledhood/agent-crypto`](https://www.npmjs.com/package/@veiledhood/agent-crypto) (Node ≥ 22, browser-compatible via WebCrypto)
- **Primitives:** AES-256-GCM (encryption) + PBKDF2-SHA256 (passphrase wrap) + HKDF-SHA256 (per-agent key derivation)
- **License:** MIT

---

## Why integrate

- **Sell "fully private strategies"** — your backend, your logs, even a compromised database cannot decrypt user strategies. You only ever see ciphertext.
- **No new key custody** — master key is generated in the user's browser, wrapped with their passphrase, and stored as opaque bytes on your backend. You don't manage it.
- **Cross-device** — same passphrase on a new device unwraps the same key. Recovery story is simple.
- **Audited primitives only** — WebCrypto / Node `crypto.subtle`. No bespoke cryptography. No `@noble/ciphers` dependency.

---

## Mental model

```
┌──────────────────────────────────────────────────────────────┐
│ User device (browser or local agent runtime)                 │
│                                                              │
│   1. K = crypto.getRandomValues(32)        ← one-time        │
│   2. envelope = wrapMasterKey(K, passphrase)                 │
│   3. POST envelope to your backend         ── ciphertext ──► │
│                                                              │
│   For each strategy:                                         │
│   4. agentKey = deriveAgentKey(K, agentId, kind)             │
│   5. ct = encrypt(agentKey, JSON.stringify(strategy), aad)   │
│   6. POST { agentId, kind, ct } to your backend  ─ ct ──►    │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ Your backend                                                 │
│                                                              │
│   - Store envelope (opaque blob, 1 per user)                 │
│   - Store {agentId, kind, ct} (opaque blob, 1 per strategy)  │
│   - You CANNOT decrypt either. Only the user can.            │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ Strategy execution (back on user device)                     │
│                                                              │
│   1. Fetch envelope from your backend                        │
│   2. K = unwrapMasterKey(envelope, passphrase)               │
│   3. Fetch {agentId, kind, ct} from your backend             │
│   4. agentKey = deriveAgentKey(K, agentId, kind)             │
│   5. strategy = JSON.parse(decryptString(agentKey, ct, aad)) │
│   6. Execute strategy locally; submit txs as normal          │
└──────────────────────────────────────────────────────────────┘
```

---

## Install

```bash
npm install @veiledhood/agent-crypto
# or
pnpm add @veiledhood/agent-crypto
# or
yarn add @veiledhood/agent-crypto
```

Works in browsers (ESM) and Node ≥ 22. No polyfills required.

---

## Step 1 — bootstrap a master key (once per user)

User picks a passphrase. You generate a random key, wrap it with the passphrase, send the envelope to your backend.

```ts
import {
  generateMasterKey,
  wrapMasterKey,
} from "@veiledhood/agent-crypto";

async function onboardUser(passphrase: string) {
  // 32-byte random key — crypto.getRandomValues under the hood
  const masterKey = generateMasterKey();

  // Wrap it with the user's passphrase (PBKDF2-SHA256 → AES-GCM)
  // Third arg is iteration count (number). Default 600_000.
  const envelope = await wrapMasterKey(masterKey, passphrase);
  // envelope shape (all fields safe to send as JSON):
  //   { salt: string (base64), iv: string (base64),
  //     ct: string (base64), iterations: number, version: 1 }

  // Send envelope to your backend — opaque ciphertext, no transformation needed
  await fetch("/api/users/me/envelope", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
  });

  // Hold masterKey in memory for the session — DO NOT persist to localStorage
  return masterKey;
}
```

**Storage:** `envelope` is a small JSON object. Persist as a single row keyed by user. You can re-fetch it any time the user logs in with their passphrase.

---

## Step 2 — encrypt a strategy

Derive a per-agent key from the master key, then encrypt the strategy JSON.

Two binding inputs to know about:

- **`kind`** — passed to `deriveAgentKey`. Mixed into HKDF so each strategy type gets a distinct key. Pick a stable string per template (`"dca"`, `"yield"`, `"rebalance"`).
- **`aad`** — passed to `encrypt`. AES-GCM Additional Authenticated Data. Binds the ciphertext to a context string so a swapped/replayed blob fails to decrypt. `agentId` is a reasonable default.

```ts
import {
  deriveAgentKey,
  encrypt,
} from "@veiledhood/agent-crypto";

async function createStrategy(
  masterKey: Uint8Array,
  agentId: string,   // your ID — could be a ULID, UUID, anything
  kind: string,      // "dca" | "yield" | "rebalance" | ...
  strategy: object,  // {asset: "USDC", target: 0.08, ...}
) {
  const agentKey = await deriveAgentKey(masterKey, agentId, kind);
  const aad = agentId; // any deterministic context string; must match on decrypt
  const ct = await encrypt(agentKey, JSON.stringify(strategy), aad);
  // ct shape:
  //   { iv: string (base64), ct: string (base64), version: 1 }

  await fetch("/api/strategies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, kind, ...ct }),
  });
}
```

**Storage:** persist `{ agentId, kind, iv, ct, version }` per strategy. No need to inspect contents.

---

## Step 3 — decrypt a strategy (at execution time)

```ts
import {
  unwrapMasterKey,
  deriveAgentKey,
  decryptString,
} from "@veiledhood/agent-crypto";

async function loadStrategy(passphrase: string, agentId: string) {
  // Fetch envelope
  const envelope = await fetch("/api/users/me/envelope").then((r) => r.json());
  const masterKey = await unwrapMasterKey(envelope, passphrase);

  // Fetch strategy ciphertext — server returns {agentId, kind, iv, ct, version}
  const row = await fetch(`/api/strategies/${agentId}`).then((r) => r.json());

  const agentKey = await deriveAgentKey(masterKey, agentId, row.kind);
  const aad = agentId; // must match the AAD used at encrypt time
  const json = await decryptString(
    agentKey,
    { iv: row.iv, ct: row.ct, version: row.version },
    aad,
  );
  return JSON.parse(json);
}
```

Decrypted strategy lives only in the user's process memory while the agent is running.

---

## Recovery on a new device

User logs in on Device B with the same passphrase:

1. Fetch the envelope from your backend (same one stored in Step 1)
2. `unwrapMasterKey(envelope, passphrase)` → same `masterKey` as on Device A
3. Decrypt strategies as normal

No data migration needed. The envelope is the recovery primitive.

If the user **forgets their passphrase**: the data is unrecoverable by design. Make this clear in your UX. Encourage users to store the passphrase in a password manager.

---

## What your backend stores

| Object | Shape | Cardinality |
|---|---|---|
| Envelope | `{ salt, iv, ct, iterations, version }` (~150 bytes) | 1 per user |
| Strategy | `{ agentId, kind, iv, ct, version }` (~200 bytes + payload) | N per user |

All opaque. None of these fields leak strategy intent or parameters.

---

## Security notes

- **Master key never leaves the user device.** Hold it in process memory; do not persist to `localStorage`, `IndexedDB`, or cookies. The envelope (not the key) is the persistent form.
- **AES-GCM nonces are random** (96-bit, fresh per encrypt). Replay attacks are mathematically prevented.
- **PBKDF2 iterations** default to 600k — OWASP 2023 recommendation. Tune higher via `wrapMasterKey(masterKey, passphrase, 1_000_000)` if you want extra margin (third arg is the iteration count, a plain number).
- **AAD mismatch on decrypt throws** — same primitive that catches tampering also catches AAD-substitution attacks. Choose a deterministic AAD and use it on both sides.
- **Constant-time comparisons** for any auth tags or HMAC checks — use `constantTimeEqual` from the package, not `===`.
- **Tampered ciphertext** throws `OperationError` from `decrypt` — handle it; don't ignore.

---

## Test it before mainnet

Round-trip test (recommended for CI):

```ts
import {
  generateMasterKey,
  deriveAgentKey,
  encrypt,
  decryptString,
} from "@veiledhood/agent-crypto";

const masterKey = generateMasterKey();
const agentKey = await deriveAgentKey(masterKey, "agent-1", "dca");
const aad = "agent-1";
const ct = await encrypt(agentKey, JSON.stringify({ foo: 1 }), aad);
const out = await decryptString(agentKey, ct, aad);
console.assert(JSON.parse(out).foo === 1, "round-trip failed");
```

The package's own test suite covers wrap/unwrap round-trip, wrong passphrase, weak passphrase rejection, tampered ciphertext, and envelope-version mismatch.

---

## What this package does NOT do

- **Authentication / authorization** — that's your backend's job. JWT, SIWE, OAuth, whatever you use.
- **Network privacy / Tor** — encryption hides *what*; if you also want to hide *who*, use Veiledhood's other surfaces.
- **Strategy execution** — this is a crypto library. Execution stays in your runtime.
- **Wallet signing** — out of scope. Use viem / ethers / your wallet SDK.

---

## Support

- **Integration questions / bug reports:** your usual partnership contact
- **Security disclosure:** security@veiledhood.to (PGP key on request)

---

## Versioning

`@veiledhood/agent-crypto` follows semver. Pin to a minor version (`^0.1.0`) to get patch updates only. We will not break the ciphertext format within a major version — anything you encrypt with `0.1.x` decrypts cleanly with `0.1.y`.

---

