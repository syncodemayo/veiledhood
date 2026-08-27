import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Application } from "express";
import mongoose from "mongoose";
import request from "supertest";

import {
  startTestMongo,
  setEnvForTest,
  makeJwt,
  randAddr,
  type TestMongo,
} from "../test/setup.js";

/**
 * Route-level tests for /swaps body validation.
 *
 * Focus: the `fee` field on poolKey must accept the full V4 uint24 range
 * (0..0xFFFFFF), including the dynamic-fee flag 0x800000 used by hook-based
 * pools (e.g. VEILEDHOOD↔WETH).
 *
 * Regression: prior schema capped at 1_000_000 which rejected any
 * dynamic-fee pool and surfaced as "Invalid body" to the user.
 */

let mem: TestMongo;
let app: Application;
let env: Awaited<ReturnType<typeof loadEnvDynamic>>;
let SwapUserBalance: typeof import("../models/SwapUserBalance.js").SwapUserBalance;
let Swap: typeof import("../models/Swap.js").Swap;

async function loadEnvDynamic() {
  const mod = await import("../config/env.js");
  return mod.loadEnv();
}

function authHeader(addr: string): { Authorization: string } {
  return { Authorization: `Bearer ${makeJwt(addr, env.JWT_SECRET)}` };
}

// Canonical addresses from veilswapPairs.ts — picked so addr-order is correct.
const WETH    = "0x4200000000000000000000000000000000000006";
const VEILEDHOOD = "0xd13ba0d625c04b8364de5e15e58bf2ebdda8dba3";
const USDC    = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ETH     = "0x0000000000000000000000000000000000000000";

before(async () => {
  mem = await startTestMongo();
  setEnvForTest(mem.uri);
  // Configure VeilSwap so the route doesn't 503 on missing config.
  process.env.RPC_URL = "http://127.0.0.1:0"; // dummy — executeSwap is fire-and-forget
  process.env.VEILSWAP_ADDRESS = "0x" + "11".repeat(20);
  env = await loadEnvDynamic();
  await mongoose.connect(env.MONGODB_URI);
  const balMod = await import("../models/SwapUserBalance.js");
  const swapMod = await import("../models/Swap.js");
  SwapUserBalance = balMod.SwapUserBalance;
  Swap = swapMod.Swap;

  const { createSwapsRouter } = await import("./swaps.js");
  app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(createSwapsRouter(env));
});

beforeEach(async () => {
  await SwapUserBalance.deleteMany({});
  await Swap.deleteMany({});
});

after(async () => {
  await mongoose.disconnect();
  await mem.stop();
  delete process.env.RPC_URL;
  delete process.env.VEILSWAP_ADDRESS;
});

async function seedBalance(addr: string, token: string, amount: string): Promise<void> {
  await SwapUserBalance.create({
    address: addr.toLowerCase(),
    chainId: env.CHAIN_ID ?? 8453,
    tokenAddress: token.toLowerCase(),
    totalAmount: amount,
  });
}

function dynamicFeePoolKey(): { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string } {
  // VEILEDHOOD↔WETH dynamic-fee hook pool from veilswapPairs.ts
  return {
    currency0: WETH,
    currency1: VEILEDHOOD,
    fee: 0x800000, // 8_388_608 — V4 dynamic-fee flag, was > old max of 1_000_000
    tickSpacing: 200,
    hooks: "0xbdf938149ac6a781f94faa0ed45e6a0e984c6544",
  };
}

function staticFeePoolKey(): { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string } {
  // ETH↔USDC 0.3% — proves the original happy path still works.
  return {
    currency0: ETH,
    currency1: USDC,
    fee: 3000,
    tickSpacing: 60,
    hooks: "0x0000000000000000000000000000000000000000",
  };
}

test("POST /swaps — dynamic-fee poolKey (fee=0x800000) passes zod, reaches 202", async () => {
  const addr = randAddr();
  await seedBalance(addr, VEILEDHOOD, "1000000000000000000"); // 1 VEILEDHOOD

  const res = await request(app)
    .post("/swaps")
    .set(authHeader(addr))
    .send({
      idempotencyKey: "test-veiledhood-weth-1",
      tokenIn: VEILEDHOOD,
      tokenOut: WETH,
      amountIn: "1000000000000000000",
      amountOutMin: "0",
      poolKey: dynamicFeePoolKey(),
    });

  assert.equal(res.status, 202, `expected 202, got ${res.status} body=${JSON.stringify(res.body)}`);
  assert.equal(res.body.status, "pending");
  assert.equal(res.body.idempotencyKey, "test-veiledhood-weth-1");
});

test("POST /swaps — fee > uint24 max (0xFFFFFF + 1) → 400 Invalid body", async () => {
  const addr = randAddr();
  await seedBalance(addr, VEILEDHOOD, "1000000000000000000");

  const res = await request(app)
    .post("/swaps")
    .set(authHeader(addr))
    .send({
      idempotencyKey: "test-overflow-fee",
      tokenIn: VEILEDHOOD,
      tokenOut: WETH,
      amountIn: "1000000000000000000",
      amountOutMin: "0",
      poolKey: { ...dynamicFeePoolKey(), fee: 0xFFFFFF + 1 },
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Invalid body");
});

test("POST /swaps — static-fee poolKey (fee=3000) still works (back-compat)", async () => {
  const addr = randAddr();
  await seedBalance(addr, ETH, "1000000000000000000");

  const res = await request(app)
    .post("/swaps")
    .set(authHeader(addr))
    .send({
      idempotencyKey: "test-eth-usdc-1",
      tokenIn: ETH,
      tokenOut: USDC,
      amountIn: "1000000000000000000",
      amountOutMin: "0",
      poolKey: staticFeePoolKey(),
    });

  assert.equal(res.status, 202, `expected 202, got ${res.status} body=${JSON.stringify(res.body)}`);
  assert.equal(res.body.status, "pending");
});

test("POST /swaps — fee=1_000_001 (above old cap, below dynamic flag) now accepted by zod", async () => {
  // Schema only — this proves the cap was widened; downstream the
  // on-chain pool wouldn't exist, but that's the contract's job to reject.
  const addr = randAddr();
  await seedBalance(addr, ETH, "1000000000000000000");

  const res = await request(app)
    .post("/swaps")
    .set(authHeader(addr))
    .send({
      idempotencyKey: "test-mid-range-fee",
      tokenIn: ETH,
      tokenOut: USDC,
      amountIn: "1000000000000000000",
      amountOutMin: "0",
      poolKey: { ...staticFeePoolKey(), fee: 1_000_001 },
    });

  assert.equal(res.status, 202, `expected 202 (zod passes), got ${res.status} body=${JSON.stringify(res.body)}`);
});
