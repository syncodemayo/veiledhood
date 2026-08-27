#!/usr/bin/env node
/**
 * MCP-layer end-to-end test against a live local API.
 *
 * Drives the compiled handlers (dist/tools/data*.js) — same code the
 * published MCP server runs. Verifies the encrypt → POST → fetch → decrypt
 * round-trip works end-to-end against http://localhost:3100.
 *
 * Usage:
 *   1. Start the API locally:
 *        cd api && PORT=3100 npm run dev
 *   2. Build the MCP server (if not already):
 *        cd packages/mcp-server && npm run build
 *   3. Run this script (from repo root or anywhere):
 *        node packages/mcp-server/scripts/test-data-tools-vs-live-api.mjs
 *
 * Exits 0 if all checks pass, 1 if any check fails.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";
import { Wallet } from "ethers";

const API_BASE = process.env.VEILEDHOOD_API_BASE ?? "http://localhost:3100";

let pass = 0;
let fail = 0;

function ok(name, detail = "") {
  pass++;
  console.log(`\x1b[32m✓\x1b[0m ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ""}`);
}
function bad(name, detail = "") {
  fail++;
  console.log(`\x1b[31m✗\x1b[0m ${name}${detail ? `  \x1b[31m${detail}\x1b[0m` : ""}`);
}
function check(name, cond, detail = "") {
  cond ? ok(name, detail) : bad(name, detail);
}

async function preflight() {
  try {
    const r = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) throw new Error(`/health returned ${r.status}`);
  } catch (e) {
    console.error(`\x1b[31m✗\x1b[0m API not reachable at ${API_BASE}`);
    console.error(`   ${e.message}`);
    process.exit(1);
  }
  ok("preflight: API reachable", `at ${API_BASE}`);
}

async function getJwt(wallet) {
  const msgRes = await fetch(`${API_BASE}/auth/message`);
  const { message } = await msgRes.json();
  const signature = await wallet.signMessage(message);
  const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!verifyRes.ok) {
    throw new Error(`/auth/verify ${verifyRes.status}: ${await verifyRes.text()}`);
  }
  return (await verifyRes.json()).token;
}

function toB64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

async function main() {
  await preflight();

  // 1. Generate ephemeral wallet + JWT for this run
  const wallet = Wallet.createRandom();
  const token = await getJwt(wallet);
  ok("auth: JWT acquired", `wallet=${wallet.address.slice(0, 10)}…`);

  // 2. Generate fresh master key for this wallet
  const rawKey = webcrypto.getRandomValues(new Uint8Array(32));

  // 3. Write throwaway session.json + master.key in tmp dir
  const dir = await mkdtemp(join(tmpdir(), "veiledhood-mcp-livetest-"));
  const sessionFile = join(dir, "session.json");
  const masterKeyFile = join(dir, "master.key");

  const decoded = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  const exp = decoded.exp;

  await writeFile(
    sessionFile,
    JSON.stringify({
      jwt: token,
      exp,
      address: wallet.address.toLowerCase(),
      apiBase: API_BASE,
    }),
    "utf8",
  );

  await writeFile(
    masterKeyFile,
    JSON.stringify({
      masterKey: toB64(rawKey),
      version: 1,
      address: wallet.address.toLowerCase(),
      createdAt: new Date().toISOString(),
    }),
    "utf8",
  );

  process.env.VEILEDHOOD_SESSION_FILE = sessionFile;
  process.env.VEILEDHOOD_MASTER_KEY_FILE = masterKeyFile;

  // 4. Import the compiled handlers — same code that ships in the published npm package.
  // Convert Windows paths to file:// URLs for ESM dynamic import.
  const distRoot = resolve(import.meta.dirname, "..", "dist");
  const fileUrl = (p) => pathToFileURL(p).href;
  const { handleDataStore } = await import(fileUrl(join(distRoot, "tools", "dataStore.js")));
  const { handleDataFetch } = await import(fileUrl(join(distRoot, "tools", "dataFetch.js")));
  const { handleDataList } = await import(fileUrl(join(distRoot, "tools", "dataList.js")));
  const { handleAgentCreate } = await import(fileUrl(join(distRoot, "tools", "agentCreate.js")));
  const { handleAgentList } = await import(fileUrl(join(distRoot, "tools", "agentList.js")));
  ok("mcp: handlers loaded from dist/");

  // ---- data_store / data_list / data_fetch round-trip -----------------------

  // T1 — data_store
  const storeRes = await handleDataStore({
    label: "test-note-1",
    data: "the password is hunter2",
  });
  check("data_store does not return isError", storeRes.isError !== true, storeRes.content[0]?.text);
  const idMatch = storeRes.content[0]?.text.match(/encrypted data ([0-9a-f-]{36})/);
  const blob1Id = idMatch?.[1];
  check("data_store returns id in response text", !!blob1Id, `id=${blob1Id ?? "<missing>"}`);

  // T2 — data_store a second blob
  const storeRes2 = await handleDataStore({
    label: "test-note-2",
    data: JSON.stringify({ secret: 42, nested: { yes: true } }),
  });
  check("data_store (#2) does not return isError", storeRes2.isError !== true);

  // T3 — data_list shows both blobs
  const listRes = await handleDataList();
  check("data_list does not return isError", listRes.isError !== true);
  check(
    "data_list shows 2 blob(s)",
    listRes.content[0]?.text.startsWith("2 encrypted blob(s)"),
    listRes.content[0]?.text.slice(0, 60),
  );
  check(
    "data_list output contains 'labels encrypted'",
    listRes.content[0]?.text.includes("labels encrypted"),
  );

  // T4 — data_fetch decrypts blob 1 back to original
  if (blob1Id) {
    const fetchRes = await handleDataFetch({ id: blob1Id });
    check("data_fetch does not return isError", fetchRes.isError !== true);
    let parsed;
    try {
      parsed = JSON.parse(fetchRes.content[0]?.text);
    } catch {
      parsed = null;
    }
    check(
      "data_fetch round-trip — label matches",
      parsed?.label === "test-note-1",
      `label=${parsed?.label}`,
    );
    check(
      "data_fetch round-trip — payload matches",
      parsed?.data === "the password is hunter2",
      `data=${parsed?.data?.slice(0, 40)}…`,
    );
    check(
      "data_fetch returns savedAt timestamp",
      typeof parsed?.savedAt === "string" && parsed.savedAt.length > 0,
      `savedAt=${parsed?.savedAt}`,
    );
  } else {
    bad("data_fetch skipped — no id from data_store");
  }

  // ---- regression: agent_create + agent_list still work -------------------------

  // T5 — agent_create (DCA) still works
  const agentCreateRes = await handleAgentCreate({
    kind: "dca",
    params: {
      fromAsset: "USDC",
      toAsset: "ETH",
      amountPerRun: "50",
      cadence: "weekly",
    },
  });
  check(
    "regression: agent_create (DCA) still succeeds",
    agentCreateRes.isError !== true,
    agentCreateRes.content[0]?.text.slice(0, 50),
  );

  // T6 — agent_list returns the DCA + data items mixed (no kind filter)
  const agentListRes = await handleAgentList();
  check("regression: agent_list does not return isError", agentListRes.isError !== true);
  const listText = agentListRes.content[0]?.text ?? "";
  check(
    "regression: agent_list shows 3 agent(s) (1 dca + 2 data, all kinds)",
    listText.startsWith("3 agent(s)"),
    listText.split("\n")[0],
  );

  // Cleanup
  delete process.env.VEILEDHOOD_SESSION_FILE;
  delete process.env.VEILEDHOOD_MASTER_KEY_FILE;
  await rm(dir, { recursive: true, force: true });

  console.log();
  console.log(`\x1b[1m${pass} pass, ${fail} fail\x1b[0m`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\x1b[31mFATAL\x1b[0m`, e);
  process.exit(1);
});
