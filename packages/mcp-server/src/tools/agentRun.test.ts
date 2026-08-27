import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { importAesKey, encrypt } from "@veiledhood/agent-crypto/aesgcm";
import { handleAgentRun } from "./agentRun.js";
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
  const e = await encrypt(aesKey, JSON.stringify(params), aad);
  return { ct: e.ct, iv: e.iv };
}

test("agent_run POSTs to /run and returns decrypted params", async () => {
  const plain = { fromAsset: "USDC", toAsset: "ETH", amountPerRun: "100", cadence: "daily" };
  const { ct, iv } = await encryptParams("dca", plain);

  fetchStub = stubFetch((url, init) => {
    assert.ok(url.includes("/run"), `url should hit /run: ${url}`);
    assert.equal(init?.method, "POST");
    return makeResponse(200, {
      agentId: "abc12345",
      kind: "dca",
      ciphertext: ct,
      iv,
      version: 1,
      status: "active",
      lastRunAt: "2025-01-02T00:00:00Z",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-02T00:00:00Z",
    });
  });

  const res = await handleAgentRun({ id: "abc12345" });
  assert.equal(res.isError, undefined);
  const parsed = JSON.parse(res.content[0]!.text);
  assert.deepEqual(parsed.params, plain);
  assert.equal(parsed.lastRunAt, "2025-01-02T00:00:00Z");
});

test("agent_run returns DECRYPT_FAILED on AAD mismatch", async () => {
  const { ct, iv } = await encryptParams("yield", { asset: "USDC", protocol: "p", minAprBps: 1, maxAllocation: "1" });
  fetchStub = stubFetch(() =>
    makeResponse(200, {
      agentId: "abc12345",
      kind: "dca",   // mismatch
      ciphertext: ct,
      iv,
      version: 1,
      status: "active",
      createdAt: "x",
      updatedAt: "y",
    }),
  );
  const res = await handleAgentRun({ id: "abc12345" });
  assert.equal(res.isError, true);
  assert.ok(res.content[0]!.text.includes("VEILEDHOOD_DECRYPT_FAILED"));
});

test("agent_run 404 propagates as VEILEDHOOD_API_NOT_FOUND", async () => {
  fetchStub = stubFetch(() => makeResponse(404, { error: "agent not found" }));
  const res = await handleAgentRun({ id: "abc12345" });
  assert.equal(res.isError, true);
  assert.ok(res.content[0]!.text.includes("VEILEDHOOD_API_NOT_FOUND"));
});
