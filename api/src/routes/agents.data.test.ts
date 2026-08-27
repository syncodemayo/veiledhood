import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import type { Application } from "express";

import {
  startTestMongo,
  setEnvForTest,
  makeJwt,
  clearAllAgentData,
  buildApp,
  randAddr,
  type TestMongo,
} from "../test/setup.js";

/**
 * Route-level tests for the kind="data" surface on /agents.
 * Validates the payload-cap split (DATA vs AGENTS), the per-kind item cap,
 * and the optional ?kind= list filter.
 */

let mem: TestMongo;
let app: Application;
let env: Awaited<ReturnType<typeof loadEnvDynamic>>;

async function loadEnvDynamic() {
  const mod = await import("../config/env.js");
  return mod.loadEnv();
}

let Agent: typeof import("../models/Agent.js").Agent;

function authHeader(addr: string): { Authorization: string } {
  return { Authorization: `Bearer ${makeJwt(addr, env.JWT_SECRET)}` };
}

function dataBody(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    kind: "data",
    ciphertext: Buffer.from("encrypted-payload").toString("base64"),
    iv: Buffer.from("123456789012").toString("base64"),
    version: 1,
    ...overrides,
  };
}

function dcaBody(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    kind: "dca",
    ciphertext: Buffer.from("encrypted-blob").toString("base64"),
    iv: Buffer.from("123456789012").toString("base64"),
    version: 1,
    ...overrides,
  };
}

before(async () => {
  mem = await startTestMongo();
  setEnvForTest(mem.uri);
  env = await loadEnvDynamic();
  await mongoose.connect(env.MONGODB_URI);
  const agentMod = await import("../models/Agent.js");
  Agent = agentMod.Agent;
  app = await buildApp(env);
});

beforeEach(async () => {
  await clearAllAgentData();
});

after(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

test("POST /agents kind=data — 201 created with a UUID id", async () => {
  const addr = randAddr();
  const res = await request(app).post("/agents").set(authHeader(addr)).send(dataBody());
  assert.equal(res.status, 201);
  assert.match(
    res.body.agentId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("POST /agents kind=data — accepts payloads up to DATA_MAX_CIPHERTEXT_BYTES", async () => {
  const addr = randAddr();
  // Just under cap — should pass
  const bigButOk = "a".repeat(env.DATA_MAX_CIPHERTEXT_BYTES - 100);
  const ok = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(dataBody({ ciphertext: bigButOk }));
  assert.equal(ok.status, 201);

  // Over cap — should reject with 413 + DATA cap (not AGENTS cap)
  const tooBig = "a".repeat(env.DATA_MAX_CIPHERTEXT_BYTES + 1);
  const fail = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(dataBody({ ciphertext: tooBig }));
  assert.equal(fail.status, 413);
  assert.equal(fail.body.maxBytes, env.DATA_MAX_CIPHERTEXT_BYTES);
});

test("POST /agents kind=dca — still capped at AGENTS_MAX_CIPHERTEXT_BYTES (not bumped by data cap)", async () => {
  const addr = randAddr();
  const oversize = "a".repeat(env.AGENTS_MAX_CIPHERTEXT_BYTES + 1);
  const res = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(dcaBody({ ciphertext: oversize }));
  assert.equal(res.status, 413);
  assert.equal(res.body.maxBytes, env.AGENTS_MAX_CIPHERTEXT_BYTES);
  // Crucially, NOT the data cap
  assert.notEqual(res.body.maxBytes, env.DATA_MAX_CIPHERTEXT_BYTES);
});

test("POST /agents kind=data — 409 only after DATA_MAX_PER_USER, not AGENTS_MAX_PER_USER", async () => {
  const addr = randAddr();
  // Seed AGENTS_MAX_PER_USER worth of data items.
  // If the per-kind cap is wrong, this would already trip 409 because
  // AGENTS_MAX_PER_USER (20) < DATA_MAX_PER_USER (100).
  const docs = Array.from({ length: env.AGENTS_MAX_PER_USER }, (_, i) => ({
    address: addr.toLowerCase(),
    agentId: `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
    kind: "data",
    ciphertext: "ct",
    iv: "iv",
    version: 1,
    status: "active",
  }));
  await Agent.insertMany(docs);

  // Adding ONE more data item must succeed — data limit (100) not yet hit.
  const res = await request(app).post("/agents").set(authHeader(addr)).send(dataBody());
  assert.equal(res.status, 201, `expected 201, body=${JSON.stringify(res.body)}`);
});

test("POST /agents kind=data and kind=dca — caps are independent", async () => {
  const addr = randAddr();
  // Fill up AGENTS cap with DCA items
  const dcaDocs = Array.from({ length: env.AGENTS_MAX_PER_USER }, (_, i) => ({
    address: addr.toLowerCase(),
    agentId: `${i.toString(16).padStart(8, "0")}-0000-4000-8000-aaaaaaaaaaaa`,
    kind: "dca",
    ciphertext: "ct",
    iv: "iv",
    version: 1,
    status: "active",
  }));
  await Agent.insertMany(dcaDocs);

  // Another DCA — should hit AGENTS cap
  const blockedDca = await request(app).post("/agents").set(authHeader(addr)).send(dcaBody());
  assert.equal(blockedDca.status, 409);

  // But a data item should still succeed — independent cap.
  const okData = await request(app).post("/agents").set(authHeader(addr)).send(dataBody());
  assert.equal(okData.status, 201);
});

test("GET /agents?kind=data — returns only data items", async () => {
  const addr = randAddr();
  await Agent.insertMany([
    {
      address: addr.toLowerCase(),
      agentId: "11111111-0000-4000-8000-000000000000",
      kind: "dca",
      ciphertext: "ct",
      iv: "iv",
      version: 1,
      status: "active",
    },
    {
      address: addr.toLowerCase(),
      agentId: "22222222-0000-4000-8000-000000000000",
      kind: "data",
      ciphertext: "ct",
      iv: "iv",
      version: 1,
      status: "active",
    },
    {
      address: addr.toLowerCase(),
      agentId: "33333333-0000-4000-8000-000000000000",
      kind: "data",
      ciphertext: "ct",
      iv: "iv",
      version: 1,
      status: "active",
    },
  ]);

  const res = await request(app).get("/agents?kind=data").set(authHeader(addr));
  assert.equal(res.status, 200);
  assert.equal(res.body.agents.length, 2);
  for (const a of res.body.agents) assert.equal(a.kind, "data");
});

test("GET /agents (no kind filter) — still returns everything (back-compat)", async () => {
  const addr = randAddr();
  await Agent.insertMany([
    {
      address: addr.toLowerCase(),
      agentId: "11111111-0000-4000-8000-000000000000",
      kind: "dca",
      ciphertext: "ct",
      iv: "iv",
      version: 1,
      status: "active",
    },
    {
      address: addr.toLowerCase(),
      agentId: "22222222-0000-4000-8000-000000000000",
      kind: "data",
      ciphertext: "ct",
      iv: "iv",
      version: 1,
      status: "active",
    },
  ]);
  const res = await request(app).get("/agents").set(authHeader(addr));
  assert.equal(res.status, 200);
  assert.equal(res.body.agents.length, 2);
});

test("GET /agents?kind=invalid — 400 invalid query", async () => {
  const addr = randAddr();
  const res = await request(app).get("/agents?kind=nope").set(authHeader(addr));
  assert.equal(res.status, 400);
});
