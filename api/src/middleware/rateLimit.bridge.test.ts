import { test } from "node:test";
import assert from "node:assert/strict";

test("bridge rate-limit key namespace is distinct", () => {
  const addr = "0xabc";
  assert.equal(`bridge:rl:min:${addr}`, "bridge:rl:min:0xabc");
  assert.equal(`bridge:rl:day:${addr}`, "bridge:rl:day:0xabc");
});
