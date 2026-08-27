import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { importAesKey, decryptString } from "@veiledhood/agent-crypto/aesgcm";
import { handleAgentUpdate, agentUpdateInputSchema } from "./agentUpdate.js";
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

test("agent_update status-only path does NOT GET first", async () => {
  fetchStub = stubFetch(() => makeResponse(200, { ok: true, updatedAt: "2025-01-02T00:00:00Z" }));
  const res = await handleAgentUpdate({ id: "abc12345", status: "paused" });
  assert.equal(res.isError, undefined);
  assert.equal(fetchStub!.calls.length, 1, "should not GET before PATCH for status-only update");
  const call = fetchStub!.calls[0]!;
  assert.equal(call.init?.method, "PATCH");
  const body = JSON.parse(call.init?.body as string);
  assert.equal(body.status, "paused");
  assert.equal(body.ciphertext, undefined);
});

test("agent_update params-only path GETs first to learn kind, then PATCHes ciphertext+iv", async () => {
  let getCalls = 0;
  let patchCalls = 0;
  fetchStub = stubFetch((url, init) => {
    if (init?.method === "PATCH") {
      patchCalls++;
      return makeResponse(200, { ok: true, updatedAt: "2025-01-02T00:00:00Z" });
    }
    getCalls++;
    return makeResponse(200, { kind: "yield" });
  });

  const newParams = { asset: "USDC", protocol: "marginfi", minAprBps: 800, maxAllocation: "5" };
  const res = await handleAgentUpdate({ id: "abc12345", params: newParams });
  assert.equal(res.isError, undefined);
  assert.equal(getCalls, 1);
  assert.equal(patchCalls, 1);

  // Find the PATCH call and verify body
  const patchCall = fetchStub!.calls.find((c) => c.init?.method === "PATCH")!;
  const body = JSON.parse(patchCall.init?.body as string);
  assert.ok(body.ciphertext, "ciphertext present");
  assert.ok(body.iv, "iv present");
  assert.equal(body.status, undefined);

  // Decrypt with the kind=yield AAD to confirm correct binding
  const aesKey = await importAesKey(env.rawKey);
  const aad = JSON.stringify({ kind: "yield", version: 1 });
  const pt = await decryptString(aesKey, { iv: body.iv, ct: body.ciphertext, version: 1 }, aad);
  assert.deepEqual(JSON.parse(pt), newParams);
});

test("agent_update with both status and params GETs kind, then PATCHes with both fields", async () => {
  fetchStub = stubFetch((url, init) => {
    if (init?.method === "PATCH") {
      return makeResponse(200, { ok: true, updatedAt: "2025-01-02T00:00:00Z" });
    }
    return makeResponse(200, { kind: "dca" });
  });
  const res = await handleAgentUpdate({
    id: "abc12345",
    status: "active",
    params: { fromAsset: "X", toAsset: "Y", amountPerRun: "1", cadence: "h" },
  });
  assert.equal(res.isError, undefined);
  const patchCall = fetchStub!.calls.find((c) => c.init?.method === "PATCH")!;
  const body = JSON.parse(patchCall.init?.body as string);
  assert.equal(body.status, "active");
  assert.ok(body.ciphertext);
  assert.ok(body.iv);
});

test("agentUpdateInputSchema rejects when neither status nor params provided", () => {
  const result = agentUpdateInputSchema.safeParse({ id: "abc12345" });
  assert.equal(result.success, false);
});
