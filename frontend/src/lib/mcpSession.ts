/**
 * MCP session bootstrap helpers.
 *
 * The dApp generates a 32-byte master AES key in the browser, wraps it with
 * a user-supplied passphrase (PBKDF2-SHA256 → AES-256-GCM), POSTs the
 * envelope to /agents/keys/envelope (server-blind), and prepares two files
 * for the user to download into `~/.veiledhood/`:
 *
 *   - session.json   { jwt, exp, address, apiBase }
 *   - master.key     { masterKey: base64(32), version: 1, address, createdAt }
 *
 * Strict shapes — the MCP server (packages/mcp-server) validates both and
 * refuses to boot if either is malformed.
 *
 * Crypto algorithm MUST stay byte-for-byte identical to
 * `packages/agent-crypto/src/envelope.ts` so an envelope wrapped here can be
 * unwrapped by the Node package on a recovery device.
 *
 * Field-name note: the wire shape uses `ciphertext` (matches the server
 * route `/agents/keys/envelope`). The agent-crypto `MasterKeyEnvelope`
 * interface internally calls the same value `ct`. Any future recovery
 * flow that pipes the wire body into `unwrapMasterKey()` must rename
 * `ciphertext` → `ct` at the boundary.
 */

const PBKDF2_SALT_BYTES = 16;
const AES_IV_BYTES = 12;
const MASTER_KEY_BYTES = 32;
export const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 recommendation
export const ENVELOPE_VERSION = 1;
export const MIN_PASSPHRASE_LENGTH = 8;

function bytesToBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s);
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/**
 * TS 5.7 + DOM lib regression workaround. `Uint8Array` is now generic over
 * `ArrayBufferLike`, but Web Crypto's `BufferSource` requires
 * `ArrayBufferView<ArrayBuffer>`. Reinterpret as a backed-by-ArrayBuffer view
 * — zero runtime cost, only narrows the type for the subtle API.
 */
function toBufferSource(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

export interface EnvelopeWireBody {
  /** Base64 16-byte PBKDF2 salt. */
  salt: string;
  /** Base64 12-byte AES-GCM IV. */
  iv: string;
  /** Base64 ciphertext + 16-byte GCM tag. */
  ciphertext: string;
  /** PBKDF2 iteration count. */
  iterations: number;
  /** Envelope schema version. */
  version: number;
}

export interface SessionJson {
  jwt: string;
  exp: number;
  address: string;
  apiBase: string;
}

export interface MasterKeyJson {
  /** Base64 of exactly 32 bytes. */
  masterKey: string;
  version: 1;
  address: string;
  createdAt: string;
}

/** Generate a fresh 32-byte master AES key in the browser. */
export function generateMasterKey(): Uint8Array {
  return randomBytes(MASTER_KEY_BYTES);
}

/**
 * Wrap a master key with a user passphrase. Output is the on-the-wire
 * shape expected by POST /agents/keys/envelope. Byte-compatible with
 * `wrapMasterKey()` in @veiledhood/agent-crypto.
 */
export async function wrapMasterKey(masterKey: Uint8Array, passphrase: string): Promise<EnvelopeWireBody> {
  if (masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error(`master key must be ${MASTER_KEY_BYTES} bytes`);
  }
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`passphrase must be >= ${MIN_PASSPHRASE_LENGTH} chars`);
  }
  const salt = randomBytes(PBKDF2_SALT_BYTES);
  const iv = randomBytes(AES_IV_BYTES);
  const baseKey = await crypto.subtle.importKey("raw", toBufferSource(new TextEncoder().encode(passphrase)), { name: "PBKDF2" }, false, ["deriveKey"]);
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: toBufferSource(salt), iterations: PBKDF2_ITERATIONS },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toBufferSource(iv), tagLength: 128 }, wrappingKey, toBufferSource(masterKey));
  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ctBuf)),
    iterations: PBKDF2_ITERATIONS,
    version: ENVELOPE_VERSION,
  };
}

/** Build the session.json contents the MCP server reads on boot. */
export function buildSessionJson(input: { jwt: string; exp: number; address: string; apiBase: string }): SessionJson {
  return {
    jwt: input.jwt,
    exp: input.exp,
    address: input.address.toLowerCase(),
    apiBase: input.apiBase.replace(/\/$/, ""),
  };
}

/** Build the master.key file contents (strict shape the MCP server expects). */
export function buildMasterKeyJson(masterKey: Uint8Array, address: string): MasterKeyJson {
  if (masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error(`master key must be ${MASTER_KEY_BYTES} bytes`);
  }
  return {
    masterKey: bytesToBase64(masterKey),
    version: 1,
    address: address.toLowerCase(),
    createdAt: new Date().toISOString(),
  };
}

/** Trigger a browser download for a JSON file. */
export function downloadJsonFile(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
