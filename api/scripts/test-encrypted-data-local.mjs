#!/usr/bin/env node
/**
 * Local end-to-end test for the kind="data" surface on /agents.
 *
 * Usage:
 *   1. Start the API locally on port 3100:
 *        cd api && PORT=3100 npm run dev
 *   2. From repo root or anywhere:
 *        node api/scripts/test-encrypted-data-local.mjs
 *
 * Overridable env:
 *   VEILEDHOOD_API_BASE   — default http://localhost:3100
 *
 * Exits 0 if all checks pass, 1 if any check fails.
 *
 * What it tests:
 *   1. Auth flow (sign-in with ethers, get JWT)
 *   2. POST /agents kind=data — small payload — 201
 *   3. POST /agents kind=data — > 1 MB payload — 413, maxBytes=DATA_MAX_CIPHERTEXT_BYTES
 *   4. POST /agents kind=data — 600 KB payload — 201 (above old 16 KB cap, below new 1 MB cap)
 *   5. POST /agents kind=dca — > 16 KB payload — 413, maxBytes=AGENTS_MAX_CIPHERTEXT_BYTES
 *   6. GET /agents — returns everything
 *   7. GET /agents?kind=data — returns only data items
 *   8. GET /agents?kind=invalid — 400
 *   9. GET /agents/:id — returns full doc with ciphertext
 *   10. GET /agents without auth — 401
 */

import { Wallet } from "ethers";

const API_BASE = process.env.VEILEDHOOD_API_BASE ?? "http://localhost:3100";

const DATA_MAX = 1_048_576;       // matches DATA_MAX_CIPHERTEXT_BYTES default
const AGENTS_MAX = 16_384;        // matches AGENTS_MAX_CIPHERTEXT_BYTES default

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
    ok("preflight: API reachable", `at ${API_BASE}`);
  } catch (e) {
    console.error(`\x1b[31m✗ API not reachable at ${API_BASE}\x1b[0m`);
    console.error(`   ${e.message}`);
    console.error("");
    console.error("   Start the API first:");
    console.error("     cd api && PORT=3100 npm run dev");
    process.exit(1);
  }
}

async function getJwt(wallet) {
  const msgRes = await fetch(`${API_BASE}/auth/message`);
  if (!msgRes.ok) throw new Error(`/auth/message returned ${msgRes.status}`);
  const { message } = await msgRes.json();

  const signature = await wallet.signMessage(message);

  const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!verifyRes.ok) {
    const body = await verifyRes.text();
    throw new Error(`/auth/verify ${verifyRes.status}: ${body}`);
  }
  return (await verifyRes.json()).token;
}

async function withAuth(token, path, init = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(init.headers ?? {}),
  };
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { ...init, headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function ivB64() {
  // base64 of a fixed 12-byte IV — route does not decrypt, just stores
  return Buffer.from("000000000000", "utf8").toString("base64");
}

function ctB64(byteCount) {
  // produce a base64 string of approximately `byteCount` characters.
  // since the route caps on UTF-8 byte length of the base64 STRING, we make
  // the string itself the right size (not the underlying binary).
  return "a".repeat(byteCount);
}

async function main() {
  await preflight();

  const wallet = Wallet.createRandom();
  console.log(`\x1b[90mTest wallet: ${wallet.address}\x1b[0m`);

  let token;
  try {
    token = await getJwt(wallet);
    ok("auth: JWT acquired", `length=${token.length}`);
  } catch (e) {
    bad("auth: JWT acquisition failed", e.message);
    process.exit(1);
  }

  // T1 — small data payload → 201
  let firstDataId;
  {
    const { status, body } = await withAuth(token, "/agents", {
      method: "POST",
      body: JSON.stringify({
        kind: "data",
        ciphertext: ctB64(500),
        iv: ivB64(),
        version: 1,
      }),
    });
    check("POST /agents kind=data (small) → 201", status === 201, `status=${status}`);
    firstDataId = body?.agentId;
  }

  // T2 — oversized data payload → 413
  {
    const { status, body } = await withAuth(token, "/agents", {
      method: "POST",
      body: JSON.stringify({
        kind: "data",
        ciphertext: ctB64(DATA_MAX + 1),
        iv: ivB64(),
        version: 1,
      }),
    });
    check(
      "POST /agents kind=data (oversize 1 MB+1) → 413",
      status === 413,
      `status=${status}`,
    );
    check(
      "  413 response carries DATA_MAX_CIPHERTEXT_BYTES",
      body?.maxBytes === DATA_MAX,
      `maxBytes=${body?.maxBytes}`,
    );
  }

  // T3 — 600 KB data payload (above old 16 KB agent cap, below 1 MB data cap) → 201
  {
    const { status } = await withAuth(token, "/agents", {
      method: "POST",
      body: JSON.stringify({
        kind: "data",
        ciphertext: ctB64(600_000),
        iv: ivB64(),
        version: 1,
      }),
    });
    check(
      "POST /agents kind=data (600 KB) → 201  (proves new cap is in effect)",
      status === 201,
      `status=${status}`,
    );
  }

  // T4 — DCA over 16 KB → 413 with AGENTS cap (NOT data cap)
  {
    const { status, body } = await withAuth(token, "/agents", {
      method: "POST",
      body: JSON.stringify({
        kind: "dca",
        ciphertext: ctB64(AGENTS_MAX + 1),
        iv: ivB64(),
        version: 1,
      }),
    });
    check(
      "POST /agents kind=dca (over 16 KB) → 413",
      status === 413,
      `status=${status}`,
    );
    check(
      "  413 carries AGENTS_MAX_CIPHERTEXT_BYTES (caps stay independent)",
      body?.maxBytes === AGENTS_MAX,
      `maxBytes=${body?.maxBytes}  expected=${AGENTS_MAX}`,
    );
  }

  // Seed a DCA agent for the list tests
  {
    const { status } = await withAuth(token, "/agents", {
      method: "POST",
      body: JSON.stringify({
        kind: "dca",
        ciphertext: ctB64(200),
        iv: ivB64(),
        version: 1,
      }),
    });
    check("seed: POST /agents kind=dca (small) → 201", status === 201, `status=${status}`);
  }

  // T5 — GET /agents → returns everything (3 items: 2 data + 1 dca)
  {
    const { status, body } = await withAuth(token, "/agents", { method: "GET" });
    check("GET /agents → 200", status === 200);
    check(
      "GET /agents returns all kinds (2 data + 1 dca = 3)",
      body?.agents?.length === 3,
      `count=${body?.agents?.length}`,
    );
  }

  // T6 — GET /agents?kind=data → only data items
  {
    const { status, body } = await withAuth(token, "/agents?kind=data", { method: "GET" });
    check("GET /agents?kind=data → 200", status === 200);
    check(
      "GET /agents?kind=data returns only kind=data (2 items)",
      body?.agents?.length === 2 && body.agents.every((a) => a.kind === "data"),
      `count=${body?.agents?.length} kinds=${body?.agents?.map((a) => a.kind).join(",")}`,
    );
  }

  // T7 — GET /agents?kind=invalid → 400
  {
    const { status } = await withAuth(token, "/agents?kind=nope", { method: "GET" });
    check("GET /agents?kind=nope → 400", status === 400, `status=${status}`);
  }

  // T8 — GET /agents/:id → 200 with full doc
  if (firstDataId) {
    const { status, body } = await withAuth(token, `/agents/${firstDataId}`, { method: "GET" });
    check(`GET /agents/${firstDataId.slice(0, 8)}… → 200`, status === 200);
    check(
      "  full doc has ciphertext + iv + kind=data",
      body?.ciphertext?.length > 0 && body?.iv?.length > 0 && body?.kind === "data",
      `kind=${body?.kind}`,
    );
  } else {
    bad("GET /agents/:id skipped — no id from T1");
  }

  // T9 — GET /agents without auth → 401
  {
    const r = await fetch(`${API_BASE}/agents`);
    check("GET /agents (no auth) → 401", r.status === 401, `status=${r.status}`);
  }

  // Summary
  console.log();
  console.log(`\x1b[1m${pass} pass, ${fail} fail\x1b[0m`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\x1b[31mFATAL\x1b[0m`, e);
  process.exit(1);
});
