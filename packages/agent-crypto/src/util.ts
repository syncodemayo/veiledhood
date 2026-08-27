// Standard base64 (RFC 4648) with padding. Works in both Node and browser.
//
// NOTE: We type byte arrays as `Uint8Array<ArrayBuffer>` (not the new TS-5.7
// default `Uint8Array<ArrayBufferLike>`) so they remain assignable to the
// Web Crypto `BufferSource` type, which requires `ArrayBufferView<ArrayBuffer>`.
// This keeps the lib zero-dep and avoids ts-ignore at every subtle call site.

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
export const utf8Encode = (s: string): Uint8Array<ArrayBuffer> => {
  // TextEncoder.encode() returns Uint8Array<ArrayBuffer> at runtime (its
  // buffer is a fresh ArrayBuffer), but the lib type widens it. Cast safely.
  return enc.encode(s) as Uint8Array<ArrayBuffer>;
};
export const utf8Decode = (b: Uint8Array): string => dec.decode(b);

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n));
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * Normalize an arbitrary `Uint8Array` (possibly typed as
 * `Uint8Array<ArrayBufferLike>` in TS 5.7+) into a `BufferSource` accepted by
 * Web Crypto. If the input is already backed by an `ArrayBuffer` we return
 * it directly; otherwise we copy into a fresh `ArrayBuffer`. Runtime cost
 * is zero in the common case.
 */
export function toBufferSource(b: Uint8Array): Uint8Array<ArrayBuffer> {
  if (b.buffer instanceof ArrayBuffer) {
    return b as Uint8Array<ArrayBuffer>;
  }
  const copy = new Uint8Array(new ArrayBuffer(b.length));
  copy.set(b);
  return copy;
}
