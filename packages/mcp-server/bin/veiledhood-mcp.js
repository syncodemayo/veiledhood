#!/usr/bin/env node
// Thin shim — Node 22+ ESM entry. Resolves to compiled output.
import("../dist/server.js")
  .then((mod) => mod.startServer())
  .catch((err) => {
    console.error("[veiledhood-mcp] failed to start:", err?.message ?? err);
    process.exit(1);
  });
