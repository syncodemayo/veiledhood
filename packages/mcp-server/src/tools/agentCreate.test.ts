import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { importAesKey, decryptString } from "@veiledhood/agent-crypto/aesgcm";
import { handleAgentCreate } from "./agentCreate.js";
import {
  setupTestEnv,
  cleanupTestEnv,
  stubFetch,
  makeResponse,
  type TestEnv,
  type FetchStub,
} from "../test/setup.js";

let env: TestEnv;
let fetchStub: FetchStub | undefined;

beforeEach(async () => {
  env = await setupTestEnv();
});
afterEach(async () => {
  fetchStub?.restore();
  fetchStub = undefined;
  await cleanupTestEnv(env);
});

test("agent_create encrypts params and POSTs the correct body shape", async () => {
  fetchStub = stubFetch(() =>
    makeResponse(201, { agentId: "abcd1234-aaaa-bbbb-cccc-1234567890ab", createdAt: "2025-01-01T00:00:00Z" }),
  );

  const res = await handleAgentCreate({
    kind: "dca",
    params: { fromAsset: "USDC", toAsset: "ETH", amountPerRun: "100", cadence: "daily" },
  });

  assert.equal(res.isError, undefined);
  assert.equal(fetchStub!.calls.length, 1);
  const call = fetchStub!.calls[0]!;
  assert.equal(call.init?.method, "POST");
  assert.ok(call.url.endsWith("/agents"), `url=${call.url}`);

  const body = JSON.parse(call.init?.body as string);
  assert.equal(body.kind, "dca");
  assert.equal(body.version, 1);
  assert.ok(body.ciphertext, "ciphertext present");
  assert.ok(body.iv, "iv present");

  // Verify ciphertext decrypts back to the original params with correct AAD
  const aesKey = await importAesKey(env.rawKey);
  const aad = JSON.stringify({ kind: "dca", version: 1 });
  const pt = await decryptString(aesKey, { iv: body.iv, ct: body.ciphertext, version: 1 }, aad);
  const decoded = JSON.parse(pt);
  assert.deepEqual(decoded, {
    fromAsset: "USDC",
    toAsset: "ETH",
    amountPerRun: "100",
    cadence: "daily",
  });
});

test("agent_create uses correct AAD ({kind, version}) — cross-kind tampering rejected", async () => {
  fetchStub = stubFetch(() =>
    makeResponse(201, { agentId: "abcd1234-aaaa-bbbb-cccc-1234567890ab", createdAt: "x" }),
  );
  await handleAgentCreate({
    kind: "yield",
    params: { asset: "USDC", protocol: "kamino", minAprBps: 500, maxAllocation: "1000" },
  });
  const body = JSON.parse(fetchStub!.calls[0]!.init?.body as string);

  const aesKey = await importAesKey(env.rawKey);
  // Try decrypt with a DIFFERENT-kind AAD — must throw
  const wrongAad = JSON.stringify({ kind: "dca", version: 1 });
  await assert.rejects(
    () => decryptString(aesKey, { iv: body.iv, ct: body.ciphertext, version: 1 }, wrongAad),
    "AAD mismatch must reject",
  );
  // Correct AAD succeeds
  const goodAad = JSON.stringify({ kind: "yield", version: 1 });
  const pt = await decryptString(aesKey, { iv: body.iv, ct: body.ciphertext, version: 1 }, goodAad);
  assert.ok(pt.includes("kamino"));
});

test("agent_create surfaces API errors as VeiledhoodMcpError via isError flag", async () => {
  fetchStub = stubFetch(() => makeResponse(409, { error: "agent limit reached" }));
  const res = await handleAgentCreate({ kind: "dca", params: { a: 1 } });
  assert.equal(res.isError, true);
  assert.ok(res.content[0]!.text.includes("VEILEDHOOD_VALIDATION_ERROR") || res.content[0]!.text.includes("limit"));
});

test("agent_create returns isError when master key missing", async () => {
  // Repoint master key file to a non-existent path
  process.env.VEILEDHOOD_MASTER_KEY_FILE = `${env.tmpDir}/no-such-file.key`;
  const { clearMasterKeyCache } = await import("../keys.js");
  clearMasterKeyCache();
  // Fetch shouldn't even be called; stub anyway so we don't hit real network
  fetchStub = stubFetch(() => makeResponse(201, { agentId: "x", createdAt: "y" }));
  const res = await handleAgentCreate({ kind: "dca", params: { a: 1 } });
  assert.equal(res.isError, true);
  assert.ok(res.content[0]!.text.includes("VEILEDHOOD_MASTER_KEY_MISSING"));
  assert.equal(fetchStub!.calls.length, 0, "should not POST when key missing");
});
