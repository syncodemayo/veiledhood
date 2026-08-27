// Client-side AES-GCM for the Data screen. Key is derived from a wallet
// signature and never leaves the browser or touches the server.

async function importKey(rawSeed: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(rawSeed), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("veiledhood-data-v1"), iterations: 150_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export class DataCrypto {
  private key: CryptoKey;
  private constructor(key: CryptoKey) {
    this.key = key;
  }
  static async fromSignature(signature: string): Promise<DataCrypto> {
    return new DataCrypto(await importKey(signature));
  }
  async encrypt(plain: unknown): Promise<{ ciphertext: string; iv: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(plain));
    const buf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, data);
    return { ciphertext: toB64(buf), iv: toB64(iv.buffer) };
  }
  async decrypt<T>(ciphertext: string, iv: string): Promise<T> {
    const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) as BufferSource }, this.key, fromB64(ciphertext) as BufferSource);
    return JSON.parse(new TextDecoder().decode(buf)) as T;
  }
}
