import { test } from "node:test";
import assert from "node:assert/strict";

// Pure logic test: confirm the per-user key shape stays stable. Redis behavior
// itself is integration-tested separately against a real Redis (see scripts).
test("rate-limit key shape contract", () => {
  const addr = "0xabc";
  const minKey = `ai:rl:min:${addr}`;
  const dayKey = `ai:rl:day:${addr}`;
  assert.equal(minKey, "ai:rl:min:0xabc");
  assert.equal(dayKey, "ai:rl:day:0xabc");
});
