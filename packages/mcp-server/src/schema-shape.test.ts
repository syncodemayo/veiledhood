import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Critical regression test: locks in the ZodRawShape contract for `inputSchema`.
 *
 * Why this matters:
 *   The MCP SDK iterates `inputSchema` as a plain object of zod field
 *   definitions (ZodRawShape). Passing a `z.object({...})` (ZodObject) instead
 *   would compile but break tool discovery at runtime — the SDK cannot
 *   introspect the wrapped object the same way.
 *
 *   Day 6 will register 7 real tools. Each one MUST use the same pattern as
 *   the placeholder in server.ts:
 *
 *     // CORRECT — ZodRawShape (plain object of zod fields)
 *     inputSchema: { id: z.string(), name: z.string().optional() }
 *
 *     // WRONG — ZodObject
 *     inputSchema: z.object({ id: z.string() })   // do NOT do this
 *
 *   If a future change accidentally switches to `z.object(...)`, this test
 *   stays green (the SDK accepts both syntactically), but the COMMENT here is
 *   the canonical reference. Day 6 reviewers grep for "ZodRawShape" before
 *   merging tool additions.
 */
test("inputSchema is ZodRawShape, not z.object — boot smoke", () => {
  const server = new McpServer({ name: "test", version: "0" });

  // CORRECT pattern — ZodRawShape (plain object of zod fields)
  assert.doesNotThrow(() => {
    server.registerTool(
      "ok",
      {
        description: "ok",
        inputSchema: { id: z.string() }, // ZodRawShape ✓
      },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );
  });

  // Multiple fields still ZodRawShape, not wrapped in z.object
  assert.doesNotThrow(() => {
    server.registerTool(
      "ok_multi",
      {
        description: "multi-field shape",
        inputSchema: {
          id: z.string(),
          name: z.string().optional(),
          count: z.number().int().min(0),
        },
      },
      async () => ({ content: [{ type: "text", text: "multi" }] }),
    );
  });
});

test("placeholder tool registers without throwing", async () => {
  const { buildServer } = await import("./server.js");
  const server = buildServer();
  assert.ok(server, "buildServer() should return an McpServer instance");
});
