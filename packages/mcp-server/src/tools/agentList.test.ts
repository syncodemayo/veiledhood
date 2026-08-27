import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { handleAgentList } from "./agentList.js";
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

test("agent_list formats output with kind/id/status/lastRunAt", async () => {
  fetchStub = stubFetch(() =>
    makeResponse(200, {
      agents: [
        {
          agentId: "id1",
          kind: "dca",
          status: "active",
          lastRunAt: "2025-01-02T00:00:00Z",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-02T00:00:00Z",
        },
        {
          agentId: "id2",
          kind: "yield",
          status: "paused",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
    }),
  );
  const res = await handleAgentList();
  assert.equal(res.isError, undefined);
  const text = res.content[0]!.text;
  assert.ok(text.includes("2 agent(s)"));
  assert.ok(text.includes("dca"));
  assert.ok(text.includes("id1"));
  assert.ok(text.includes("last_run=2025-01-02"));
  assert.ok(text.includes("yield"));
  assert.ok(text.includes("paused"));
});

test("agent_list reports empty list cleanly", async () => {
  fetchStub = stubFetch(() => makeResponse(200, { agents: [] }));
  const res = await handleAgentList();
  assert.equal(res.isError, undefined);
  assert.equal(res.content[0]!.text, "No agents yet.");
});

test("agent_list propagates API errors as isError", async () => {
  fetchStub = stubFetch(() => makeResponse(403, { error: "forbidden" }));
  const res = await handleAgentList();
  assert.equal(res.isError, true);
  assert.ok(res.content[0]!.text.includes("VEILEDHOOD_API_FORBIDDEN"));
});
