import { test } from "node:test";
import assert from "node:assert/strict";
import { unwrapMasterKey, wrapMasterKey, type MasterKeyEnvelope } from "./envelope.js";
import { generateMasterKey } from "./keys.js";

// Use a low iteration count for tests to keep them fast.
const TEST_ITERATIONS = 10_000;

test("wrap then unwrap with same passphrase recovers master key", async () => {
  const master = generateMasterKey();
  const env = await wrapMasterKey(master, "correct horse battery staple", TEST_ITERATIONS);
  const recovered = await unwrapMasterKey(env, "correct horse battery staple");
  assert.equal(recovered.length, 32);
  for (let i = 0; i < 32; i++) {
    assert.equal(recovered[i], master[i], `byte ${i} mismatch`);
  }
});

test("wrong passphrase throws", async () => {
  const master = generateMasterKey();
  const env = await wrapMasterKey(master, "rightpass", TEST_ITERATIONS);
  await assert.rejects(() => unwrapMasterKey(env, "wrongpass"));
});

test("passphrase < 8 chars throws on wrap", async () => {
  const master = generateMasterKey();
  await assert.rejects(
    () => wrapMasterKey(master, "short", TEST_ITERATIONS),
    /passphrase must be >= 8 chars/,
  );
});

test("tampered ciphertext throws on unwrap", async () => {
  const master = generateMasterKey();
  const env = await wrapMasterKey(master, "correct horse battery staple", TEST_ITERATIONS);
  const ctBytes = Uint8Array.from(atob(env.ct), (c) => c.charCodeAt(0));
  ctBytes[0] = ctBytes[0]! ^ 0x01;
  let bin = "";
  for (let i = 0; i < ctBytes.length; i++) bin += String.fromCharCode(ctBytes[i]!);
  const tampered: MasterKeyEnvelope = { ...env, ct: btoa(bin) };
  await assert.rejects(() => unwrapMasterKey(tampered, "correct horse battery staple"));
});

test("version mismatch throws", async () => {
  const master = generateMasterKey();
  const env = await wrapMasterKey(master, "correct horse battery staple", TEST_ITERATIONS);
  const bad: MasterKeyEnvelope = { ...env, version: 99 };
  await assert.rejects(
    () => unwrapMasterKey(bad, "correct horse battery staple"),
    /unsupported version 99/,
  );
});
