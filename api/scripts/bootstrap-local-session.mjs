#!/usr/bin/env node
/**
 * Bootstrap a throwaway local-dev session for the Veiledhood MCP server.
 *
 * Writes session.local.json + master.local.key into ~/.veiledhood/ for an
 * ephemeral wallet, with a fresh JWT signed by the LOCAL API's secret.
 *
 * Does NOT touch the existing session.json / master.key (prod session).
 *
 * Usage:
 *   1. Start the API locally:
 *        cd api && PORT=3100 npm run dev
 *   2. Run this script (from anywhere):
 *        node api/scripts/bootstrap-local-session.mjs
 *
 * After it runs, point a "veiledhood-local" MCP entry at the two .local files
 * via the env block in ~/.claude.json (see README in script output).
 */

import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { webcrypto } from "node:crypto";
import { Wallet } from "ethers";

const API_BASE = process.env.VEILEDHOOD_API_BASE ?? "http://localhost:3100";
const VEILEDHOOD_DIR = join(homedir(), ".veiledhood");
const SESSION_FILE = join(VEILEDHOOD_DIR, "session.local.json");
const MASTER_KEY_FILE = join(VEILEDHOOD_DIR, "master.local.key");

function toB64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

async function main() {
  // Preflight
  try {
    const r = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) throw new Error(`/health returned ${r.status}`);
  } catch (e) {
    console.error(`✗ API not reachable at ${API_BASE}: ${e.message}`);
    console.error(`   Start it first: cd api && PORT=3100 npm run dev`);
    process.exit(1);
  }

  // Generate ephemeral wallet
  const wallet = Wallet.createRandom();
  const address = wallet.address.toLowerCase();

  // Auth flow against LOCAL API
  const { message } = await (await fetch(`${API_BASE}/auth/message`)).json();
  const signature = await wallet.signMessage(message);
  const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!verifyRes.ok) {
    console.error(`✗ /auth/verify ${verifyRes.status}: ${await verifyRes.text()}`);
    process.exit(1);
  }
  const { token } = await verifyRes.json();
  const decoded = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  const exp = decoded.exp;

  // Fresh 32-byte master key
  const rawKey = webcrypto.getRandomValues(new Uint8Array(32));

  await writeFile(
    SESSION_FILE,
    JSON.stringify(
      {
        jwt: token,
        exp,
        address,
        apiBase: API_BASE,
      },
      null,
      2,
    ),
    "utf8",
  );

  await writeFile(
    MASTER_KEY_FILE,
    JSON.stringify(
      {
        masterKey: toB64(rawKey),
        version: 1,
        address,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`✓ Wrote ${SESSION_FILE}`);
  console.log(`✓ Wrote ${MASTER_KEY_FILE}`);
  console.log();
  console.log(`Local wallet: ${address}`);
  console.log(`JWT expires:  ${new Date(exp * 1000).toISOString()}`);
  console.log(`apiBase:      ${API_BASE}`);
  console.log();
  console.log(`Add this block to ~/.claude.json under "mcpServers" alongside the existing "veiledhood" entry:`);
  console.log();
  const distPath = join(
    process.cwd().endsWith("api") ? join(process.cwd(), "..") : process.cwd(),
    "packages",
    "mcp-server",
    "dist",
    "server.js",
  );
  // Print the JSON snippet with proper Windows path escaping
  const snippet = {
    "veiledhood-local": {
      type: "stdio",
      command: "node",
      args: [join(homedir(), "Desktop", "Claude", "Veiledhood", "packages", "mcp-server", "bin", "veiledhood-mcp.js")],
      env: {
        VEILEDHOOD_SESSION_FILE: SESSION_FILE,
        VEILEDHOOD_MASTER_KEY_FILE: MASTER_KEY_FILE,
      },
    },
  };
  console.log(JSON.stringify(snippet, null, 2));
  console.log();
  console.log(`Then restart Claude Code (or /mcp reload) and the "veiledhood-local" tools will appear.`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
