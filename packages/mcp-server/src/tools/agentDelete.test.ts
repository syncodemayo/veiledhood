import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { handleAgentDelete } from "./agentDelete.js";
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

test("agent_delete success path returns confirmation", async () => {
  fetchStub = stubFetch(() => makeResponse(200, { ok: true }));
  const res = await handleAgentDelete({ id: "abc12345" });
  assert.equal(res.isError, undefined);
  assert.ok(res.content[0]!.text.includes("Deleted agent abc12345"));
  assert.equal(fetchStub!.calls[0]!.init?.method, "DELETE");
});

test("agent_delete 404 surfaces as VEILEDHOOD_API_NOT_FOUND", async () => {
  fetchStub = stubFetch(() => makeResponse(404, { error: "agent not found" }));
  const res = await handleAgentDelete({ id: "abc12345" });
  assert.equal(res.isError, true);
  assert.ok(res.content[0]!.text.includes("VEILEDHOOD_API_NOT_FOUND"));
});
