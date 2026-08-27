import { test } from "node:test";
import assert from "node:assert/strict";
import { SolRouterCallError } from "./solRouterClient.js";

test("SolRouterCallError stores kind and retryable", () => {
  const e = new SolRouterCallError("nope", "network", true);
  assert.equal(e.kind, "network");
  assert.equal(e.retryable, true);
  assert.equal(e.name, "SolRouterCallError");
  assert.match(e.message, /nope/);
});
