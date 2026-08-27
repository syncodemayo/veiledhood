import { test } from "node:test";
import assert from "node:assert/strict";
import { buildServer, startServer } from "./server.js";

// Regression test for the bin-shim contract. The bin shim
// (bin/veiledhood-mcp.js) imports `dist/server.js` and calls `startServer()`.
// If that export disappears or its signature changes, the MCP server boots
// silently to a dead process. This test pins the contract so the bin shim
// keeps working in production.
test("server.ts exports startServer as an async function for bin shim", () => {
  assert.equal(typeof startServer, "function", "startServer must be a function");
  assert.equal(
    startServer.constructor.name,
    "AsyncFunction",
    "startServer must be async (bin shim awaits it)",
  );
});

test("server.ts still exports buildServer for unit tests", () => {
  const server = buildServer();
  assert.ok(server, "buildServer should return a server instance");
});
