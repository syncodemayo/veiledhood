// Drives the MCP server over stdio JSON-RPC. Verifies all 7 tools work
// end-to-end against the local API + session.json + master.key.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(__dirname, "..", "bin", "veiledhood-mcp.js");

const child = spawn(process.execPath, [binPath], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});

let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  }
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(`[mcp-stderr] ${chunk}`);
});

function send(method, params) {
  const id = nextId++;
  const req = { jsonrpc: "2.0", id, method, params };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify(req) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout on ${method} (id=${id})`));
      }
    }, 15000);
  });
}

function callTool(name, args) {
  return send("tools/call", { name, arguments: args ?? {} });
}

function showText(resp, label) {
  const content = resp.result?.content?.[0]?.text ?? JSON.stringify(resp);
  console.log(`\n--- ${label} ---`);
  console.log(content);
  return content;
}

try {
  const init = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "veiledhood-smoke-driver", version: "0.0.1" },
  });
  console.log("[init] server:", init.result?.serverInfo);
  // The MCP SDK expects the client to send `notifications/initialized` after init.
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
      "\n",
  );

  const list = await send("tools/list", {});
  console.log("[tools/list] count:", list.result?.tools?.length);
  for (const t of list.result?.tools ?? []) {
    console.log("  -", t.name);
  }

  // wallet_status
  const status = await callTool("wallet_status", {});
  showText(status, "wallet_status");

  // agent_create (DCA)
  const created = await callTool("agent_create", {
    kind: "dca",
    params: {
      fromAsset: "USDC",
      toAsset: "ETH",
      amountPerRun: "50",
      cadence: "weekly",
      maxSlippageBps: 50,
    },
  });
  const createdText = showText(created, "agent_create");
  const idMatch = createdText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  if (!idMatch) throw new Error("Could not extract agentId from create response");
  const agentId = idMatch[0];
  console.log("[capture] agentId:", agentId);

  // agent_list
  showText(await callTool("agent_list", {}), "agent_list");

  // agent_get
  showText(await callTool("agent_get", { id: agentId }), "agent_get (decrypts)");

  // agent_update — pause
  showText(
    await callTool("agent_update", { id: agentId, status: "paused" }),
    "agent_update (pause)",
  );

  // agent_run
  showText(await callTool("agent_run", { id: agentId }), "agent_run");

  // agent_delete
  showText(await callTool("agent_delete", { id: agentId }), "agent_delete");

  // agent_list should now omit (soft-deleted invisibility)
  showText(await callTool("agent_list", {}), "agent_list (post-delete)");

  console.log("\n=== ALL TOOLS ROUND-TRIPPED OK ===");
  child.kill();
  process.exit(0);
} catch (e) {
  console.error("\n[FATAL]", e);
  child.kill();
  process.exit(1);
}
