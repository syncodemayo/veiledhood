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
 * Route-level tests for `/agents/*`. Boots an in-memory mongo, connects
 * mongoose, signs real JWTs, and drives the Express app via supertest.
 *
 * Redis is bypassed via AGENTS_RATE_LIMIT_DISABLED=true. Auth runs end-to-end
 * (no mock). Cross-user isolation is exercised explicitly because that's the
 * highest-blast-radius bug class for these endpoints.
 */

let mem: TestMongo;
let app: Application;
let env: Awaited<ReturnType<typeof loadEnvDynamic>>;

// Load env via dynamic import so it picks up the vars we set in `before()`.
async function loadEnvDynamic() {
  const mod = await import("../config/env.js");
  return mod.loadEnv();
}

// Models — imported dynamically AFTER mongoose connects.
let Agent: typeof import("../models/Agent.js").Agent;
let AgentEnvelope: typeof import("../models/AgentEnvelope.js").AgentEnvelope;

function authHeader(addr: string): { Authorization: string } {
  return { Authorization: `Bearer ${makeJwt(addr, env.JWT_SECRET)}` };
}

function validAgentBody(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    kind: "dca",
    ciphertext: Buffer.from("encrypted-blob").toString("base64"),
    iv: Buffer.from("123456789012").toString("base64"),
    version: 1,
    ...overrides,
  };
}

function validEnvelopeBody(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    salt: Buffer.from("0123456789012345").toString("base64"),
    iv: Buffer.from("123456789012").toString("base64"),
    ciphertext: Buffer.from("wrapped-master-key").toString("base64"),
    iterations: 600_000,
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
  const envelopeMod = await import("../models/AgentEnvelope.js");
  Agent = agentMod.Agent;
  AgentEnvelope = envelopeMod.AgentEnvelope;
  app = await buildApp(env);
});

beforeEach(async () => {
  await clearAllAgentData();
});

after(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

// === Group B: POST /agents ====================================================

test("POST /agents — 201 with agentId + createdAt on valid body", async () => {
  const addr = randAddr();
  const res = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody());
  assert.equal(res.status, 201);
  assert.ok(typeof res.body.agentId === "string");
  assert.ok(res.body.createdAt);
  // UUID v4 shape
  assert.match(
    res.body.agentId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("POST /agents — 400 when `kind` is missing", async () => {
  const addr = randAddr();
  const body = validAgentBody();
  delete body.kind;
  const res = await request(app).post("/agents").set(authHeader(addr)).send(body);
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Invalid request body");
});

test("POST /agents — 400 when `kind` not in enum", async () => {
  const addr = randAddr();
  const res = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody({ kind: "invalid" }));
  assert.equal(res.status, 400);
});

test("POST /agents — 400 when ciphertext is empty string", async () => {
  const addr = randAddr();
  const res = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody({ ciphertext: "" }));
  assert.equal(res.status, 400);
});

test("POST /agents — 413 when ciphertext exceeds max bytes", async () => {
  const addr = randAddr();
  const oversize = "a".repeat(env.AGENTS_MAX_CIPHERTEXT_BYTES + 1);
  const res = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody({ ciphertext: oversize }));
  assert.equal(res.status, 413);
  assert.equal(res.body.maxBytes, env.AGENTS_MAX_CIPHERTEXT_BYTES);
});

test("POST /agents — 409 when user has AGENTS_MAX_PER_USER active agents", async () => {
  const addr = randAddr();
  // Seed exactly MAX active agents directly (faster than 20 HTTP calls).
  const docs = Array.from({ length: env.AGENTS_MAX_PER_USER }, (_, i) => ({
    address: addr.toLowerCase(),
    agentId: `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
    kind: "dca",
    ciphertext: "ct",
    iv: "iv",
    version: 1,
    status: "active",
  }));
  await Agent.insertMany(docs);

  const res = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody());
  assert.equal(res.status, 409);
  assert.equal(res.body.max, env.AGENTS_MAX_PER_USER);
});

// === Group C: GET /agents (list) ==============================================

test("GET /agents — empty list for fresh user", async () => {
  const addr = randAddr();
  const res = await request(app).get("/agents").set(authHeader(addr));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { agents: [] });
});

test("GET /agents — never includes ciphertext / iv / salt", async () => {
  const addr = randAddr();
  await request(app).post("/agents").set(authHeader(addr)).send(validAgentBody());
  const res = await request(app).get("/agents").set(authHeader(addr));
  assert.equal(res.status, 200);
  assert.equal(res.body.agents.length, 1);
  const item = res.body.agents[0];
  assert.equal(item.ciphertext, undefined);
  assert.equal(item.iv, undefined);
  assert.equal(item.salt, undefined);
  assert.equal(item.kind, "dca");
});

test("GET /agents — excludes soft-deleted agents", async () => {
  const addr = randAddr();
  const create = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody());
  const id = create.body.agentId as string;
  await request(app).delete(`/agents/${id}`).set(authHeader(addr));
  const res = await request(app).get("/agents").set(authHeader(addr));
  assert.equal(res.status, 200);
  assert.equal(res.body.agents.length, 0);
});

test("GET /agents — never returns another user's agents", async () => {
  const userA = randAddr();
  const userB = randAddr();
  await request(app).post("/agents").set(authHeader(userA)).send(validAgentBody());
  const res = await request(app).get("/agents").set(authHeader(userB));
  assert.equal(res.status, 200);
  assert.equal(res.body.agents.length, 0);
});

// === Group D: GET /agents/:id =================================================

test("GET /agents/:id — 200 with full doc (ciphertext + iv) for owner", async () => {
  const addr = randAddr();
  const create = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody());
  const id = create.body.agentId as string;
  const res = await request(app).get(`/agents/${id}`).set(authHeader(addr));
  assert.equal(res.status, 200);
  assert.equal(res.body.agentId, id);
  assert.ok(res.body.ciphertext);
  assert.ok(res.body.iv);
  assert.equal(res.body.kind, "dca");
});

test("GET /agents/:id — 404 for soft-deleted agent", async () => {
  const addr = randAddr();
  const create = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody());
  const id = create.body.agentId as string;
  await request(app).delete(`/agents/${id}`).set(authHeader(addr));
  const res = await request(app).get(`/agents/${id}`).set(authHeader(addr));
  assert.equal(res.status, 404);
});

test("GET /agents/:id — 404 cross-user (cannot read another user's agent)", async () => {
  const userA = randAddr();
  const userB = randAddr();
  const create = await request(app)
    .post("/agents")
    .set(authHeader(userA))
    .send(validAgentBody());
  const id = create.body.agentId as string;
  const res = await request(app).get(`/agents/${id}`).set(authHeader(userB));
  assert.equal(res.status, 404);
});

test("GET /agents/:id — 400 on malformed id", async () => {
  const addr = randAddr();
  const res = await request(app)
    .get("/agents/not-a-uuid!")
    .set(authHeader(addr));
  assert.equal(res.status, 400);
});

// === Group E: PATCH /agents/:id ===============================================

test("PATCH /agents/:id — 200 on status change", async () => {
  const addr = randAddr();
  const create = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody());
  const id = create.body.agentId as string;
  const res = await request(app)
    .patch(`/agents/${id}`)
    .set(authHeader(addr))
    .send({ status: "paused" });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const after = await request(app).get(`/agents/${id}`).set(authHeader(addr));
  assert.equal(after.body.status, "paused");
});

test("PATCH /agents/:id — 200 on ciphertext + iv change", async () => {
  const addr = randAddr();
  const create = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody());
  const id = create.body.agentId as string;
  const newCt = Buffer.from("new-blob").toString("base64");
  const newIv = Buffer.from("xyz456789012").toString("base64");
  const res = await request(app)
    .patch(`/agents/${id}`)
    .set(authHeader(addr))
    .send({ ciphertext: newCt, iv: newIv });
  assert.equal(res.status, 200);
  const got = await request(app).get(`/agents/${id}`).set(authHeader(addr));
  assert.equal(got.body.ciphertext, newCt);
  assert.equal(got.body.iv, newIv);
});

test("PATCH /agents/:id — 400 when ciphertext supplied without iv", async () => {
  const addr = randAddr();
  const create = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody());
  const id = create.body.agentId as string;
  const res = await request(app)
    .patch(`/agents/${id}`)
    .set(authHeader(addr))
    .send({ ciphertext: Buffer.from("only-ct").toString("base64") });
  assert.equal(res.status, 400);
});

test("PATCH /agents/:id — 400 when body has neither status nor ciphertext", async () => {
  const addr = randAddr();
  const create = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody());
  const id = create.body.agentId as string;
  const res = await request(app)
    .patch(`/agents/${id}`)
    .set(authHeader(addr))
    .send({});
  assert.equal(res.status, 400);
});

test("PATCH /agents/:id — 404 on missing agent", async () => {
  const addr = randAddr();
  const fakeId = "00000000-0000-4000-8000-000000000000";
  const res = await request(app)
    .patch(`/agents/${fakeId}`)
    .set(authHeader(addr))
    .send({ status: "paused" });
  assert.equal(res.status, 404);
});

test("PATCH /agents/:id — 413 when new ciphertext exceeds size limit", async () => {
  const addr = randAddr();
  const create = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody());
  const id = create.body.agentId as string;
  const oversize = "a".repeat(env.AGENTS_MAX_CIPHERTEXT_BYTES + 1);
  const res = await request(app)
    .patch(`/agents/${id}`)
    .set(authHeader(addr))
    .send({ ciphertext: oversize, iv: Buffer.from("123456789012").toString("base64") });
  assert.equal(res.status, 413);
});

// === Group F: DELETE /agents/:id ==============================================

test("DELETE /agents/:id — 200 + agent soft-deleted in mongo", async () => {
  const addr = randAddr();
  const create = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody());
  const id = create.body.agentId as string;
  const del = await request(app).delete(`/agents/${id}`).set(authHeader(addr));
  assert.equal(del.status, 200);
  const raw = await Agent.findOne({ agentId: id }).lean<{ status: string } | null>();
  assert.equal(raw?.status, "deleted");
});

test("DELETE /agents/:id — second delete returns 404", async () => {
  const addr = randAddr();
  const create = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody());
  const id = create.body.agentId as string;
  await request(app).delete(`/agents/${id}`).set(authHeader(addr));
  const second = await request(app).delete(`/agents/${id}`).set(authHeader(addr));
  assert.equal(second.status, 404);
});

test("DELETE /agents/:id — GET after delete returns 404", async () => {
  const addr = randAddr();
  const create = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody());
  const id = create.body.agentId as string;
  await request(app).delete(`/agents/${id}`).set(authHeader(addr));
  const res = await request(app).get(`/agents/${id}`).set(authHeader(addr));
  assert.equal(res.status, 404);
});

test("DELETE /agents/:id — cannot delete another user's agent (404)", async () => {
  const userA = randAddr();
  const userB = randAddr();
  const create = await request(app)
    .post("/agents")
    .set(authHeader(userA))
    .send(validAgentBody());
  const id = create.body.agentId as string;
  const res = await request(app).delete(`/agents/${id}`).set(authHeader(userB));
  assert.equal(res.status, 404);
  // confirm A's agent still active
  const raw = await Agent.findOne({ agentId: id }).lean<{ status: string } | null>();
  assert.equal(raw?.status, "active");
});

// === Group G: POST /agents/:id/run ===========================================

test("POST /agents/:id/run — 200 and lastRunAt is bumped", async () => {
  const addr = randAddr();
  const create = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody());
  const id = create.body.agentId as string;
  const before = await request(app).get(`/agents/${id}`).set(authHeader(addr));
  const beforeLastRunAt = before.body.lastRunAt;
  // Sleep 5ms to guarantee a new Date is strictly > before
  await new Promise((r) => setTimeout(r, 5));
  const res = await request(app).post(`/agents/${id}/run`).set(authHeader(addr));
  assert.equal(res.status, 200);
  assert.ok(res.body.lastRunAt);
  assert.notEqual(res.body.lastRunAt, beforeLastRunAt);
});

test("POST /agents/:id/run — 200 returns full doc including ciphertext", async () => {
  const addr = randAddr();
  const create = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody());
  const id = create.body.agentId as string;
  const res = await request(app).post(`/agents/${id}/run`).set(authHeader(addr));
  assert.equal(res.status, 200);
  assert.ok(res.body.ciphertext);
  assert.ok(res.body.iv);
  assert.equal(res.body.agentId, id);
});

test("POST /agents/:id/run — 404 when agent doesn't exist or is soft-deleted", async () => {
  const addr = randAddr();
  const fakeId = "00000000-0000-4000-8000-000000000000";
  const missing = await request(app).post(`/agents/${fakeId}/run`).set(authHeader(addr));
  assert.equal(missing.status, 404);

  const create = await request(app)
    .post("/agents")
    .set(authHeader(addr))
    .send(validAgentBody());
  const id = create.body.agentId as string;
  await request(app).delete(`/agents/${id}`).set(authHeader(addr));
  const deleted = await request(app).post(`/agents/${id}/run`).set(authHeader(addr));
  assert.equal(deleted.status, 404);
});

// === Group H: /agents/keys/envelope ===========================================

test("POST + GET /agents/keys/envelope — round-trip returns same fields", async () => {
  const addr = randAddr();
  const body = validEnvelopeBody();
  const post = await request(app)
    .post("/agents/keys/envelope")
    .set(authHeader(addr))
    .send(body);
  assert.equal(post.status, 201);
  const get = await request(app).get("/agents/keys/envelope").set(authHeader(addr));
  assert.equal(get.status, 200);
  assert.equal(get.body.salt, body.salt);
  assert.equal(get.body.iv, body.iv);
  assert.equal(get.body.ciphertext, body.ciphertext);
  assert.equal(get.body.iterations, body.iterations);
  assert.equal(get.body.version, body.version);
});

test("POST /agents/keys/envelope — upsert (second post updates, does not duplicate)", async () => {
  const addr = randAddr();
  await request(app)
    .post("/agents/keys/envelope")
    .set(authHeader(addr))
    .send(validEnvelopeBody({ iterations: 100_000 }));
  await request(app)
    .post("/agents/keys/envelope")
    .set(authHeader(addr))
    .send(validEnvelopeBody({ iterations: 600_000 }));
  const count = await AgentEnvelope.countDocuments({ address: addr.toLowerCase() });
  assert.equal(count, 1);
  const get = await request(app).get("/agents/keys/envelope").set(authHeader(addr));
  assert.equal(get.body.iterations, 600_000);
});

test("GET /agents/keys/envelope — 404 for fresh user with no envelope", async () => {
  const addr = randAddr();
  const res = await request(app).get("/agents/keys/envelope").set(authHeader(addr));
  assert.equal(res.status, 404);
});

test("POST /agents/keys/envelope — 400 on invalid body (negative iterations)", async () => {
  const addr = randAddr();
  const res = await request(app)
    .post("/agents/keys/envelope")
    .set(authHeader(addr))
    .send(validEnvelopeBody({ iterations: -1 }));
  assert.equal(res.status, 400);
});

test("/agents/keys/envelope — cross-user isolation", async () => {
  const userA = randAddr();
  const userB = randAddr();
  await request(app)
    .post("/agents/keys/envelope")
    .set(authHeader(userA))
    .send(validEnvelopeBody());
  const res = await request(app).get("/agents/keys/envelope").set(authHeader(userB));
  assert.equal(res.status, 404);
});
