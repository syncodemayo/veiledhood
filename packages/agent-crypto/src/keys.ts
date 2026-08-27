import { hkdfSha256 } from "./hkdf.js";
import { importAesKey } from "./aesgcm.js";
import { randomBytes, utf8Encode } from "./util.js";

const MASTER_KEY_BYTES = 32;
const HKDF_SALT = "veiledhood:agent:v1";

/** Generate a fresh 32-byte master key. Browser or Node. */
export function generateMasterKey(): Uint8Array {
  return randomBytes(MASTER_KEY_BYTES);
}

/**
 * Derive a per-agent AES-256 key from the master key + agent identity.
 * `info` = `agentId|kind` ensures different agents get different keys
 * even if the master key is shared across the user's many agents.
 */
export async function deriveAgentKey(
  masterKey: Uint8Array,
  agentId: string,
  kind: string,
): Promise<CryptoKey> {
  if (masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error(`deriveAgentKey: masterKey must be ${MASTER_KEY_BYTES} bytes`);
  }
  const info = utf8Encode(`${agentId}|${kind}`);
  const raw = await hkdfSha256(masterKey, HKDF_SALT, info, 32);
  return importAesKey(raw);
}
