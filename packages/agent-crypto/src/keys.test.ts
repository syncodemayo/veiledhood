import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAgentKey, generateMasterKey } from "./keys.js";
import { decrypt, encrypt } from "./aesgcm.js";
import { utf8Decode } from "./util.js";

test("generateMasterKey returns 32 bytes", () => {
  const k = generateMasterKey();
  assert.equal(k.length, 32);
});

test("two generated master keys differ", () => {
  const a = generateMasterKey();
  const b = generateMasterKey();
  let identical = true;
  for (let i = 0; i < 32; i++) {
    if (a[i] !== b[i]) {
      identical = false;
      break;
    }
  }
  assert.equal(identical, false);
});

test("deriveAgentKey is deterministic — cross-decryption works", async () => {
  const master = generateMasterKey();
  const k1 = await deriveAgentKey(master, "agt-1", "dca");
  const k2 = await deriveAgentKey(master, "agt-1", "dca");
  const env = await encrypt(k1, "payload", "aad");
  const out = await decrypt(k2, env, "aad");
  assert.equal(utf8Decode(out), "payload");
});

test("different agentIds yield different sub-keys", async () => {
  const master = generateMasterKey();
  const ka = await deriveAgentKey(master, "a", "dca");
  const kb = await deriveAgentKey(master, "b", "dca");
  const env = await encrypt(ka, "payload", "aad");
  await assert.rejects(() => decrypt(kb, env, "aad"));
});

test("different kinds yield different sub-keys", async () => {
  const master = generateMasterKey();
  const ka = await deriveAgentKey(master, "agt-1", "dca");
  const kb = await deriveAgentKey(master, "agt-1", "limit");
  const env = await encrypt(ka, "payload", "aad");
  await assert.rejects(() => decrypt(kb, env, "aad"));
});

test("deriveAgentKey throws on wrong-length master key", async () => {
  const bad = new Uint8Array(16).fill(1);
  await assert.rejects(() => deriveAgentKey(bad, "agt-1", "dca"), /masterKey must be 32 bytes/);
});
