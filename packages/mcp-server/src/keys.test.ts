import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { loadMasterKey, clearMasterKeyCache, buildAad } from "./keys.js";
import { VeiledhoodMcpError } from "./errors.js";
import { setupTestEnv, cleanupTestEnv, type TestEnv, TEST_ADDR } from "./test/setup.js";

function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

let env: TestEnv;

beforeEach(async () => {
  env = await setupTestEnv();
});
afterEach(async () => {
  await cleanupTestEnv(env);
});

test("loadMasterKey parses a valid master.key file", async () => {
  const { aesKey, rawKey, address } = await loadMasterKey();
  assert.equal(address, TEST_ADDR);
  assert.equal(rawKey.length, 32);
  assert.ok(aesKey, "aesKey should be present");
});

test("loadMasterKey throws VEILEDHOOD_MASTER_KEY_MISSING when file absent", async () => {
  // Point to a non-existent path
  process.env.VEILEDHOOD_MASTER_KEY_FILE = `${env.tmpDir}/does-not-exist.key`;
  clearMasterKeyCache();
  await assert.rejects(
    () => loadMasterKey(),
    (e: unknown) => {
      assert.ok(e instanceof VeiledhoodMcpError);
      assert.equal((e as VeiledhoodMcpError).code, "VEILEDHOOD_MASTER_KEY_MISSING");
      return true;
    },
  );
});

test("loadMasterKey throws VEILEDHOOD_MASTER_KEY_MALFORMED on bad JSON", async () => {
  await writeFile(env.masterKeyFile, "{not json}", "utf8");
  clearMasterKeyCache();
  await assert.rejects(
    () => loadMasterKey(),
    (e: unknown) => {
      assert.ok(e instanceof VeiledhoodMcpError);
      assert.equal((e as VeiledhoodMcpError).code, "VEILEDHOOD_MASTER_KEY_MALFORMED");
      return true;
    },
  );
});

test("loadMasterKey throws VEILEDHOOD_MASTER_KEY_MALFORMED on wrong key length", async () => {
  const shortKey = webcrypto.getRandomValues(new Uint8Array(16)); // wrong size
  await writeFile(
    env.masterKeyFile,
    JSON.stringify({
      masterKey: toB64(shortKey),
      version: 1,
      address: TEST_ADDR,
    }),
    "utf8",
  );
  clearMasterKeyCache();
  await assert.rejects(
    () => loadMasterKey(),
    (e: unknown) => {
      assert.ok(e instanceof VeiledhoodMcpError);
      assert.equal((e as VeiledhoodMcpError).code, "VEILEDHOOD_MASTER_KEY_MALFORMED");
      return true;
    },
  );
});

test("clearMasterKeyCache forces re-read", async () => {
  const first = await loadMasterKey();
  // Mutate file on disk to a new key
  const newKey = webcrypto.getRandomValues(new Uint8Array(32));
  await writeFile(
    env.masterKeyFile,
    JSON.stringify({ masterKey: toB64(newKey), version: 1, address: TEST_ADDR }),
    "utf8",
  );
  // Without clearing, cached value should still match the original
  const cached = await loadMasterKey();
  assert.equal(cached.rawKey, first.rawKey, "cache should still hold original");

  clearMasterKeyCache();
  const reloaded = await loadMasterKey();
  assert.notEqual(reloaded.rawKey, first.rawKey, "after clear, should re-read");
  assert.equal(reloaded.rawKey.length, 32);
});

test("buildAad produces deterministic JSON shape", () => {
  const a = buildAad("dca", 1);
  const b = buildAad("dca", 1);
  assert.equal(a, b);
  assert.equal(a, JSON.stringify({ kind: "dca", version: 1 }));
});
