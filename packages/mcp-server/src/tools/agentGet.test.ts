import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { importAesKey, encrypt } from "@veiledhood/agent-crypto/aesgcm";
import { handleAgentGet } from "./agentGet.js";
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

async function encryptParams(kind: string, params: object): Promise<{ ct: string; iv: string }> {
  const aesKey = await importAesKey(env.rawKey);
  const aad = JSON.stringify({ kind, version: 1 });
  const env2 = await encrypt(aesKey, JSON.stringify(params), aad);
  return { ct: env2.ct, iv: env2.iv };
}

test("agent_get decrypts plaintext params round-trip", async () => {
  const plain = { fromAsset: "USDC", toAsset: "ETH", amountPerRun: "100", cadence: "daily" };
  const { ct, iv } = await encryptParams("dca", plain);

  fetchStub = stubFetch(() =>
    makeResponse(200, {
      agentId: "abc12345",
      kind: "dca",
      ciphertext: ct,
      iv,
      version: 1,
      status: "active",
      lastRunAt: null,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-02T00:00:00Z",
    }),
  );

  const res = await handleAgentGet({ id: "abc12345" });
  assert.equal(res.isError, undefined);
  const parsed = JSON.parse(res.content[0]!.text);
  assert.deepEqual(parsed.params, plain);
  assert.equal(parsed.kind, "dca");
  assert.equal(parsed.agentId, "abc12345");
});

test("agent_get returns DECRYPT_FAILED when AAD mismatch (server returns wrong kind)", async () => {
  // Encrypt as yield but server returns kind=dca → AAD mismatch
  const { ct, iv } = await encryptParams("yield", { asset: "USDC", protocol: "kamino", minAprBps: 500, maxAllocation: "1" });
  fetchStub = stubFetch(() =>
    makeResponse(200, {
      agentId: "abc12345",
      kind: "dca",     // wrong kind reported
      ciphertext: ct,
      iv,
      version: 1,
      status: "active",
      createdAt: "x",
      updatedAt: "y",
    }),
  );
  const res = await handleAgentGet({ id: "abc12345" });
  assert.equal(res.isError, true);
  assert.ok(res.content[0]!.text.includes("VEILEDHOOD_DECRYPT_FAILED"));
});

test("agent_get propagates 404 as VEILEDHOOD_API_NOT_FOUND", async () => {
  fetchStub = stubFetch(() => makeResponse(404, { error: "agent not found" }));
  const res = await handleAgentGet({ id: "abc12345" });
  assert.equal(res.isError, true);
  assert.ok(res.content[0]!.text.includes("VEILEDHOOD_API_NOT_FOUND"));
});

test("agent_get returns DECRYPT_FAILED when plaintext is not valid JSON", async () => {
  // Encrypt non-JSON garbage with the correct AAD
  const aesKey = await importAesKey(env.rawKey);
  const aad = JSON.stringify({ kind: "dca", version: 1 });
  const envelope = await encrypt(aesKey, "this-is-not-json", aad);

  fetchStub = stubFetch(() =>
    makeResponse(200, {
      agentId: "abc12345",
      kind: "dca",
      ciphertext: envelope.ct,
      iv: envelope.iv,
      version: 1,
      status: "active",
      createdAt: "x",
      updatedAt: "y",
    }),
  );
  const res = await handleAgentGet({ id: "abc12345" });
  assert.equal(res.isError, true);
  assert.ok(res.content[0]!.text.includes("VEILEDHOOD_DECRYPT_FAILED"));
});
