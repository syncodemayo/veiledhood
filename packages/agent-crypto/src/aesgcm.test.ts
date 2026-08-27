import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decrypt,
  decryptString,
  encrypt,
  importAesKey,
  type AesGcmCiphertext,
} from "./aesgcm.js";
import { randomBytes, utf8Decode } from "./util.js";

async function makeKey(): Promise<CryptoKey> {
  return importAesKey(randomBytes(32));
}

test("round-trip 1KB random plaintext with AAD", async () => {
  const key = await makeKey();
  const plaintext = randomBytes(1024);
  const env = await encrypt(key, plaintext, "hello");
  const out = await decrypt(key, env, "hello");
  assert.equal(out.length, plaintext.length);
  for (let i = 0; i < plaintext.length; i++) {
    assert.equal(out[i], plaintext[i]);
  }
});

test("AAD mismatch throws", async () => {
  const key = await makeKey();
  const env = await encrypt(key, "secret", "a");
  await assert.rejects(() => decrypt(key, env, "b"));
});

test("tampered ciphertext throws", async () => {
  const key = await makeKey();
  const env = await encrypt(key, "secret", "aad");
  // Flip a bit in ct: decode, mutate, re-encode
  const ctBytes = Uint8Array.from(atob(env.ct), (c) => c.charCodeAt(0));
  ctBytes[0] = ctBytes[0]! ^ 0x01;
  let bin = "";
  for (let i = 0; i < ctBytes.length; i++) bin += String.fromCharCode(ctBytes[i]!);
  const tampered: AesGcmCiphertext = { ...env, ct: btoa(bin) };
  await assert.rejects(() => decrypt(key, tampered, "aad"));
});

test("tampered IV throws", async () => {
  const key = await makeKey();
  const env = await encrypt(key, "secret", "aad");
  const ivBytes = Uint8Array.from(atob(env.iv), (c) => c.charCodeAt(0));
  ivBytes[0] = ivBytes[0]! ^ 0x01;
  let bin = "";
  for (let i = 0; i < ivBytes.length; i++) bin += String.fromCharCode(ivBytes[i]!);
  const tampered: AesGcmCiphertext = { ...env, iv: btoa(bin) };
  await assert.rejects(() => decrypt(key, tampered, "aad"));
});

test("empty plaintext round-trip", async () => {
  const key = await makeKey();
  const env = await encrypt(key, "", "aad");
  const out = await decrypt(key, env, "aad");
  assert.equal(out.length, 0);
  assert.equal(utf8Decode(out), "");
});

test("16KB plaintext round-trip", async () => {
  const key = await makeKey();
  const pt = randomBytes(16 * 1024);
  const env = await encrypt(key, pt, "big");
  const out = await decrypt(key, env, "big");
  assert.equal(out.length, pt.length);
  // Spot-check a few bytes
  assert.equal(out[0], pt[0]);
  assert.equal(out[pt.length - 1], pt[pt.length - 1]);
});

test("wrong key throws", async () => {
  const k1 = await makeKey();
  const k2 = await makeKey();
  const env = await encrypt(k1, "secret", "aad");
  await assert.rejects(() => decrypt(k2, env, "aad"));
});

test("version mismatch throws", async () => {
  const key = await makeKey();
  const env = await encrypt(key, "secret", "aad");
  const bad: AesGcmCiphertext = { ...env, version: 99 };
  await assert.rejects(() => decrypt(key, bad, "aad"), /unsupported version 99/);
});

test("decryptString returns UTF-8", async () => {
  const key = await makeKey();
  const msg = "Veiledhood agent 🛡️ payload";
  const env = await encrypt(key, msg, "agt-1|dca|v1");
  const out = await decryptString(key, env, "agt-1|dca|v1");
  assert.equal(out, msg);
});
