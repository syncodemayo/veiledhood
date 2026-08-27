import { toBufferSource, utf8Encode } from "./util.js";

/**
 * HKDF-SHA256: derive `length` bytes from input keying material `ikm`,
 * salt, and info. RFC 5869.
 *
 * `ikm` must be at least 16 bytes. `salt` may be empty; if empty an
 * all-zero salt of HashLen (32) bytes is used per spec.
 */
export async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array | string,
  info: Uint8Array | string,
  length: number,
): Promise<Uint8Array> {
  if (ikm.length < 16) {
    throw new Error("hkdfSha256: ikm must be >= 16 bytes");
  }
  if (length < 1 || length > 8160) {
    throw new Error("hkdfSha256: length must be in [1, 8160]");
  }
  const saltBytes = typeof salt === "string" ? utf8Encode(salt) : salt;
  const infoBytes = typeof info === "string" ? utf8Encode(info) : info;

  // Use Web Crypto's deriveBits with HKDF.
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    "raw",
    toBufferSource(ikm),
    { name: "HKDF" },
    false,
    ["deriveBits"],
  );
  const derived = await globalThis.crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toBufferSource(saltBytes),
      info: toBufferSource(infoBytes),
    },
    keyMaterial,
    length * 8,
  );
  return new Uint8Array(derived);
}
