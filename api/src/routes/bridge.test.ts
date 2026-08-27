import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { Env } from "../config/env.js";
import { createBridgeRouter } from "./bridge.js";
import { Bridge } from "../models/Bridge.js";

const JWT_SECRET = "test-secret-do-not-use-in-prod-0000";
const USER = "0x1111111111111111111111111111111111111111";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

function makeEnv(enabled: boolean): Env {
  return {
    JWT_SECRET,
    BRIDGE_ENABLED: enabled,
    CHAIN_ID: 8453,
    BASE_CHAIN_ID: 8453,
    ETH_CHAIN_ID: 1,
    DEBRIDGE_API_URL: "https://dln.debridge.finance/v1.0",
    DEBRIDGE_STATS_API_URL: "https://dln-api.debridge.finance/api",
    BRIDGE_FEE_BPS: 0,
    BRIDGE_USER_DAILY_QUOTA: 10,
  } as unknown as Env;
}

function token(): string {
  return jwt.sign({ sub: USER }, JWT_SECRET, { expiresIn: "1h" });
}

let mem: MongoMemoryServer;
let server: import("http").Server;
let baseUrl: string;

function listen(enabled: boolean): Promise<void> {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use(createBridgeRouter(makeEnv(enabled)));
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

before(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri());
});
after(async () => {
  if (server) server.close();
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await Bridge.deleteMany({});
  if (server) server.close();
});

test("fee-quote returns 503 when bridging disabled", async () => {
  await listen(false);
  const res = await fetch(`${baseUrl}/bridge/fee-quote`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token()}` },
    body: JSON.stringify({ sourceChainId: 8453, destChainId: 1, currency: USDC, amount: "1000000" }),
  });
  assert.equal(res.status, 503);
});

test("fee-quote returns 400 for an unsupported chain pair", async () => {
  await listen(true);
  const res = await fetch(`${baseUrl}/bridge/fee-quote`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token()}` },
    body: JSON.stringify({ sourceChainId: 8453, destChainId: 137, currency: USDC, amount: "1000000" }),
  });
  assert.equal(res.status, 400);
});

test("fee-quote accepts the native currency key (schema passes; gated by enable flag)", async () => {
  await listen(false); // disabled → 503 proves the body passed schema validation (not 400)
  const res = await fetch(`${baseUrl}/bridge/fee-quote`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token()}` },
    body: JSON.stringify({ sourceChainId: 8453, destChainId: 1, currency: "native", amount: "10000000000000000" }),
  });
  assert.equal(res.status, 503);
});

test("fee-quote returns 400 for a malformed body", async () => {
  await listen(true);
  const res = await fetch(`${baseUrl}/bridge/fee-quote`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token()}` },
    body: JSON.stringify({ sourceChainId: 8453, destChainId: 1, currency: "notanaddress", amount: "0" }),
  });
  assert.equal(res.status, 400);
});

test("requests without a token are rejected 401", async () => {
  await listen(true);
  const res = await fetch(`${baseUrl}/bridge/fee-quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceChainId: 8453, destChainId: 1, currency: USDC, amount: "1000000" }),
  });
  assert.equal(res.status, 401);
});

test("GET unknown bridge returns 404", async () => {
  await listen(true);
  const res = await fetch(`${baseUrl}/bridge/brg_does_not_exist`, {
    headers: { authorization: `Bearer ${token()}` },
  });
  assert.equal(res.status, 404);
});
