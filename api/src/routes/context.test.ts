import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import type { Application } from "express";

import {
  startTestMongo,
  setEnvForTest,
  makeJwt,
  buildContextApp,
  randAddr,
  type TestMongo,
} from "../test/setup.js";
import type {
  WalletContextAggregator,
  WalletContextShielded,
  WalletContextPublic,
  WalletContextFull,
} from "../services/walletContextAggregator.js";

/**
 * Route-level tests for /context/*. Uses an in-memory Mongo for env loading
 * compatibility (env loader requires MONGODB_URI), but mocks the aggregator
 * entirely so we test only:
 *   • JWT auth gating
 *   • zod body validation
 *   • chainId default + override
 *   • aggregator delegation + response shape
 *
 * Aggregator behavior is unit-tested separately.
 */

let mem: TestMongo;
let env: Awaited<ReturnType<typeof loadEnvDynamic>>;
let app: Application;

async function loadEnvDynamic() {
  const mod = await import("../config/env.js");
  return mod.loadEnv();
}

interface MockAggCalls {
  shielded: Array<{ address: string; chainId: number }>;
  public: Array<{ address: string; chainId: number }>;
  full: Array<{ address: string; chainId: number }>;
}

let calls: MockAggCalls;

function authHeader(addr: string): { Authorization: string } {
  return { Authorization: `Bearer ${makeJwt(addr, env.JWT_SECRET)}` };
}

function makeMockAggregator(): { aggregator: WalletContextAggregator; calls: MockAggCalls } {
  const c: MockAggCalls = { shielded: [], public: [], full: [] };
  const sample = (address: string, chainId: number) => {
    const shielded: WalletContextShielded = {
      address,
      chainId,
      balances: [
        { currency: "usdc", amount: "4200000000", decimals: 6, symbol: "USDC", usdValue: 4200 },
      ],
      totalUsd: 4200,
      at: Date.now(),
    };
    const pub: WalletContextPublic = {
      address,
      chainId,
      native: { symbol: "ETH", balance: "1000000000000000000", priceUsd: 3500, usdValue: 3500 },
      tokens: [
        {
          address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          symbol: "USDC",
          decimals: 6,
          balance: "100000000",
          priceUsd: 1,
          usdValue: 100,
        },
      ],
      totalUsd: 3600,
      at: Date.now(),
    };
    const full: WalletContextFull = {
      address,
      chainId,
      shielded: { balances: shielded.balances, totalUsd: shielded.totalUsd },
      public: { native: pub.native, tokens: pub.tokens, totalUsd: pub.totalUsd },
      totalUsd: 7800,
      at: Date.now(),
      privacy: { decoyRatio: 0, batchWindowMs: 10 },
    };
    return { shielded, pub, full };
  };
  return {
    aggregator: {
      getShielded: async (address, chainId) => {
        c.shielded.push({ address, chainId });
        return sample(address, chainId).shielded;
      },
      getPublic: async (address, chainId) => {
        c.public.push({ address, chainId });
        return sample(address, chainId).pub;
      },
      getFull: async (address, chainId) => {
        c.full.push({ address, chainId });
        return sample(address, chainId).full;
      },
    },
    calls: c,
  };
}

before(async () => {
  mem = await startTestMongo();
  setEnvForTest(mem.uri);
  env = await loadEnvDynamic();
  await mongoose.connect(env.MONGODB_URI);
  const mock = makeMockAggregator();
  calls = mock.calls;
  app = await buildContextApp(env, { aggregator: mock.aggregator });
});

beforeEach(() => {
  calls.shielded.length = 0;
  calls.public.length = 0;
  calls.full.length = 0;
});

after(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

// === Auth gating ====

test("POST /context/full — no JWT → 401", async () => {
  const res = await request(app).post("/context/full").send({});
  assert.equal(res.status, 401);
});

test("POST /context/shielded — no JWT → 401", async () => {
  const res = await request(app).post("/context/shielded").send({});
  assert.equal(res.status, 401);
});

test("POST /context/public — no JWT → 401", async () => {
  const res = await request(app).post("/context/public").send({});
  assert.equal(res.status, 401);
});

// === Happy path: defaults ====

test("POST /context/full — no body uses default Base chain", async () => {
  const addr = randAddr();
  const res = await request(app).post("/context/full").set(authHeader(addr)).send({});
  assert.equal(res.status, 200);
  assert.equal(calls.full.length, 1);
  assert.equal(calls.full[0]!.chainId, 8453);
  assert.equal(calls.full[0]!.address.toLowerCase(), addr.toLowerCase());
});

test("POST /context/full — chainId honored from body", async () => {
  const addr = randAddr();
  const res = await request(app)
    .post("/context/full")
    .set(authHeader(addr))
    .send({ chainId: 1 });
  assert.equal(res.status, 200);
  assert.equal(calls.full[0]!.chainId, 1);
});

test("POST /context/shielded — happy path returns expected shape", async () => {
  const addr = randAddr();
  const res = await request(app).post("/context/shielded").set(authHeader(addr)).send({});
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.balances));
  assert.equal(typeof res.body.totalUsd, "number");
  assert.equal(typeof res.body.at, "number");
});

test("POST /context/public — happy path returns native + tokens", async () => {
  const addr = randAddr();
  const res = await request(app).post("/context/public").set(authHeader(addr)).send({});
  assert.equal(res.status, 200);
  assert.ok(res.body.native);
  assert.equal(res.body.native.symbol, "ETH");
  assert.ok(Array.isArray(res.body.tokens));
});

test("POST /context/full — privacy metadata exposed", async () => {
  const addr = randAddr();
  const res = await request(app).post("/context/full").set(authHeader(addr)).send({});
  assert.equal(res.status, 200);
  assert.ok(res.body.privacy);
  assert.equal(typeof res.body.privacy.decoyRatio, "number");
  assert.equal(typeof res.body.privacy.batchWindowMs, "number");
});

// === Validation ====

test("POST /context/full — invalid chainId returns 400", async () => {
  const addr = randAddr();
  const res = await request(app)
    .post("/context/full")
    .set(authHeader(addr))
    .send({ chainId: -1 });
  assert.equal(res.status, 400);
});

test("POST /context/full — unsupported chain returns 400", async () => {
  const addr = randAddr();
  const res = await request(app)
    .post("/context/full")
    .set(authHeader(addr))
    .send({ chainId: 137 }); // Polygon — not supported in v0.3
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Unsupported chain/);
});

test("POST /context/full — bad body shape returns 400", async () => {
  const addr = randAddr();
  const res = await request(app)
    .post("/context/full")
    .set(authHeader(addr))
    .send({ chainId: "not-a-number" });
  assert.equal(res.status, 400);
});

// === Privacy invariant: address comes from JWT, NOT body ====

test("POST /context/full — caller cannot query someone else by passing address in body", async () => {
  const me = randAddr();
  const stranger = randAddr();
  const res = await request(app)
    .post("/context/full")
    .set(authHeader(me))
    .send({ address: stranger }); // body field is ignored — schema doesn't include `address`
  assert.equal(res.status, 200);
  assert.equal(calls.full[0]!.address.toLowerCase(), me.toLowerCase());
  assert.notEqual(calls.full[0]!.address.toLowerCase(), stranger.toLowerCase());
});

test("response address echoes JWT subject (lowercase)", async () => {
  const addr = randAddr();
  const res = await request(app).post("/context/full").set(authHeader(addr)).send({});
  assert.equal(res.body.address.toLowerCase(), addr.toLowerCase());
});

// === Error path ====

test("POST /context/full — aggregator throws → 503 (NOT 500, NOT leaking error)", async () => {
  // Build a fresh app with an aggregator that always rejects
  const throwingAgg: WalletContextAggregator = {
    getShielded: async () => {
      throw new Error("internal mongo failure with holder 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
    },
    getPublic: async () => {
      throw new Error("RPC blew up");
    },
    getFull: async () => {
      throw new Error("aggregator failed");
    },
  };
  const failingApp = await buildContextApp(env, { aggregator: throwingAgg });
  const addr = randAddr();
  const res = await request(failingApp).post("/context/full").set(authHeader(addr)).send({});
  assert.equal(res.status, 503);
  // Response body MUST NOT leak the internal error message (which might contain
  // a holder address in poorly-written internal error strings)
  assert.equal(res.body.error, "Wallet context temporarily unavailable");
  const bodyText = JSON.stringify(res.body);
  assert.doesNotMatch(bodyText, /0x[a-fA-F0-9]{40}/, "response must not echo any wallet address");
});

test("POST /context/shielded — aggregator throws → 500 + sanitized error", async () => {
  const throwingAgg: WalletContextAggregator = {
    getShielded: async () => {
      throw new Error("mongo down");
    },
    getPublic: async () => sampleResponses().pub,
    getFull: async () => sampleResponses().full,
  };
  const failingApp = await buildContextApp(env, { aggregator: throwingAgg });
  const addr = randAddr();
  const res = await request(failingApp)
    .post("/context/shielded")
    .set(authHeader(addr))
    .send({});
  assert.equal(res.status, 500);
  assert.equal(res.body.error, "Internal error fetching shielded context");
});

function sampleResponses() {
  const addr = "0x0000000000000000000000000000000000000aaa";
  const chainId = 8453;
  const pub: WalletContextPublic = {
    address: addr,
    chainId,
    native: { symbol: "ETH", balance: "0", priceUsd: null, usdValue: null },
    tokens: [],
    totalUsd: null,
    at: Date.now(),
  };
  const full: WalletContextFull = {
    address: addr,
    chainId,
    shielded: { balances: [], totalUsd: null },
    public: { native: pub.native, tokens: [], totalUsd: null },
    totalUsd: null,
    at: Date.now(),
    privacy: { decoyRatio: 0, batchWindowMs: 10 },
  };
  return { pub, full };
}
