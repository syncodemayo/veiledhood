import {
  base64ToBytes,
  bytesToBase64,
  randomBytes,
  toBufferSource,
  utf8Encode,
} from "./util.js";

/** Wrapped master-key envelope. Opaque to the server. */
export interface MasterKeyEnvelope {
  /** Base64 16-byte PBKDF2 salt. */
  salt: string;
  /** Base64 12-byte AES-GCM IV. */
  iv: string;
  /** Base64 ciphertext + 16-byte tag. */
  ct: string;
  /** PBKDF2 iteration count. */
  iterations: number;
  /** Envelope schema version. */
  version: number;
}

const PBKDF2_SALT_BYTES = 16;
const AES_IV_BYTES = 12;
const DEFAULT_ITERATIONS = 600_000; // OWASP 2023 recommendation for PBKDF2-SHA256
const KEY_LENGTH_BYTES = 32;

async function deriveWrappingKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    toBufferSource(utf8Encode(passphrase)),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return globalThis.crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: toBufferSource(salt), iterations },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Wrap a master key with a passphrase. Output is opaque ciphertext. */
export async function wrapMasterKey(
  masterKey: Uint8Array,
  passphrase: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<MasterKeyEnvelope> {
  if (masterKey.length !== KEY_LENGTH_BYTES) {
    throw new Error(`wrapMasterKey: masterKey must be ${KEY_LENGTH_BYTES} bytes`);
  }
  if (passphrase.length < 8) {
    throw new Error("wrapMasterKey: passphrase must be >= 8 chars");
  }
  const salt = randomBytes(PBKDF2_SALT_BYTES);
  const iv = randomBytes(AES_IV_BYTES);
  const wrappingKey = await deriveWrappingKey(passphrase, salt, iterations);
  const ctBuf = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBufferSource(iv), tagLength: 128 },
    wrappingKey,
    toBufferSource(masterKey),
  );
  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ctBuf)),
    iterations,
    version: 1,
  };
}

/** Unwrap a master-key envelope with the user's passphrase. */
export async function unwrapMasterKey(
  envelope: MasterKeyEnvelope,
  passphrase: string,
): Promise<Uint8Array> {
  if (envelope.version !== 1) {
    throw new Error(`unwrapMasterKey: unsupported version ${envelope.version}`);
  }
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ct = base64ToBytes(envelope.ct);
  const wrappingKey = await deriveWrappingKey(passphrase, salt, envelope.iterations);
  const ptBuf = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toBufferSource(iv), tagLength: 128 },
    wrappingKey,
    toBufferSource(ct),
  );
  const masterKey = new Uint8Array(ptBuf);
  if (masterKey.length !== KEY_LENGTH_BYTES) {
    throw new Error(`unwrapMasterKey: decrypted key has wrong length ${masterKey.length}`);
  }
  return masterKey;
}
