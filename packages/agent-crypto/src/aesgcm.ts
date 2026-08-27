import {
  base64ToBytes,
  bytesToBase64,
  randomBytes,
  toBufferSource,
  utf8Decode,
  utf8Encode,
} from "./util.js";

/** Opaque ciphertext envelope returned by `encrypt`. */
export interface AesGcmCiphertext {
  /** Base64-encoded 12-byte IV. */
  iv: string;
  /** Base64-encoded ciphertext + 16-byte GCM tag (concatenated by subtle). */
  ct: string;
  /** Schema version. Default 1. */
  version: number;
}

const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BITS = 128;

/** Import a raw 32-byte key as an AES-GCM CryptoKey. */
export async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (rawKey.length !== 32) {
    throw new Error("importAesKey: key must be 32 bytes (AES-256)");
  }
  return globalThis.crypto.subtle.importKey(
    "raw",
    toBufferSource(rawKey),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * AEAD encrypt with a fresh IV. AAD binds the ciphertext to whatever
 * context the caller provides (e.g. `{kind, agentId, version}` JSON).
 * Tampering with AAD on decrypt will throw.
 */
export async function encrypt(
  key: CryptoKey,
  plaintext: string | Uint8Array,
  aad: string | Uint8Array,
): Promise<AesGcmCiphertext> {
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const ptBytes = typeof plaintext === "string" ? utf8Encode(plaintext) : plaintext;
  const aadBytes = typeof aad === "string" ? utf8Encode(aad) : aad;
  const ctBuf = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toBufferSource(iv),
      additionalData: toBufferSource(aadBytes),
      tagLength: AES_GCM_TAG_BITS,
    },
    key,
    toBufferSource(ptBytes),
  );
  return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ctBuf)), version: 1 };
}

/**
 * AEAD decrypt. Throws if AAD doesn't match, ciphertext is tampered, or
 * key is wrong. The subtle API rejects with `OperationError` in those cases.
 */
export async function decrypt(
  key: CryptoKey,
  envelope: AesGcmCiphertext,
  aad: string | Uint8Array,
): Promise<Uint8Array> {
  if (envelope.version !== 1) {
    throw new Error(`decrypt: unsupported version ${envelope.version}`);
  }
  const iv = base64ToBytes(envelope.iv);
  const ct = base64ToBytes(envelope.ct);
  const aadBytes = typeof aad === "string" ? utf8Encode(aad) : aad;
  const ptBuf = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toBufferSource(iv),
      additionalData: toBufferSource(aadBytes),
      tagLength: AES_GCM_TAG_BITS,
    },
    key,
    toBufferSource(ct),
  );
  return new Uint8Array(ptBuf);
}

/** Convenience: decrypt and return plaintext as a UTF-8 string. */
export async function decryptString(
  key: CryptoKey,
  envelope: AesGcmCiphertext,
  aad: string | Uint8Array,
): Promise<string> {
  return utf8Decode(await decrypt(key, envelope, aad));
}
