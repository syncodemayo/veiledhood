import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import {
  startTestMongo,
  setEnvForTest,
  clearAllUserBalances,
  type TestMongo,
} from "../test/setup.js";
import { createWalletContextAggregator } from "./walletContextAggregator.js";
import type { PooledRpcProxy, TokenBalance } from "./pooledRpcProxy.js";
import type { PriceOracle, PriceResult } from "./priceOracle.js";
import type { TokenListEntry } from "../util/tokenLists.js";
import type { Env } from "../config/env.js";

let mem: TestMongo;
let env: Env;
let UserBalance: typeof import("../models/UserBalance.js").UserBalance;

async function loadEnvDynamic(): Promise<Env> {
  const mod = await import("../config/env.js");
  return mod.loadEnv();
}

/** Build a `PooledRpcProxy` whose results are fully scripted. */
function makeMockProxy(opts: {
  tokenBalances: Record<string, string>; // tokenAddrLower → raw balance string
  nativeBalance: string;
}): PooledRpcProxy {
  return {
    getBalances: async (
      _chainId: number,
      _holder: string,
      tokens?: ReadonlyArray<TokenListEntry>,
    ): Promise<TokenBalance[]> => {
      const list = tokens ?? [];
      return list.map((t) => ({
        address: t.address,
        symbol: t.symbol,
        decimals: t.decimals,
        balance: opts.tokenBalances[t.address] ?? "0",
      }));
    },
    getNativeBalance: async (): Promise<TokenBalance> => ({
      address: "native",
      symbol: "ETH",
      decimals: 18,
      balance: opts.nativeBalance,
    }),
    health: async () => ({ ok: true, chains: {} }),
  };
}

function makeMockOracle(prices: Record<string, number>): PriceOracle {
  return {
    getPriceUsd: async (token: TokenListEntry): Promise<PriceResult> => {
      const usd = prices[token.address];
      return usd !== undefined
        ? { priceUsd: usd, source: "pyth", at: Date.now() }
        : { priceUsd: null, source: null, at: Date.now() };
    },
    getPricesUsd: async (tokens: ReadonlyArray<TokenListEntry>) => {
      const m = new Map<string, PriceResult>();
      for (const t of tokens) {
        const usd = prices[t.address];
        m.set(
          t.address,
          usd !== undefined
            ? { priceUsd: usd, source: "pyth", at: Date.now() }
            : { priceUsd: null, source: null, at: Date.now() },
        );
      }
      return m;
    },
    health: async () => ({ ok: true, pyth: true, coingecko: true }),
  };
}

const BASE = 8453;
const HOLDER = "0x0000000000000000000000000000000000000aaa";

const BASE_USDC_ADDR = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BASE_WETH_ADDR = "0x4200000000000000000000000000000000000006";

before(async () => {
  mem = await startTestMongo();
  setEnvForTest(mem.uri);
  env = await loadEnvDynamic();
  await mongoose.connect(env.MONGODB_URI);
  const mod = await import("../models/UserBalance.js");
  UserBalance = mod.UserBalance;
});

beforeEach(async () => {
  await clearAllUserBalances();
});

after(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

test("getPublic — multicall results + price → correct USD math (USDC 6 decimals)", async () => {
  const proxy = makeMockProxy({
    tokenBalances: { [BASE_USDC_ADDR]: "4200000000" }, // 4,200 USDC (6 decimals)
    nativeBalance: "0",
  });
  const oracle = makeMockOracle({ [BASE_USDC_ADDR]: 1.0, [BASE_WETH_ADDR]: 3500 });
  const agg = createWalletContextAggregator(env, { proxy, oracle });
  const r = await agg.getPublic(HOLDER, BASE);
  const usdc = r.tokens.find((t) => t.address === BASE_USDC_ADDR);
  assert.ok(usdc);
  assert.equal(usdc!.balance, "4200000000");
  assert.equal(usdc!.priceUsd, 1.0);
  assert.equal(usdc!.usdValue, 4200);
});

test("getPublic — WETH 18-decimal math (0.5 WETH @ $3500)", async () => {
  const proxy = makeMockProxy({
    tokenBalances: { [BASE_WETH_ADDR]: "500000000000000000" }, // 0.5 WETH
    nativeBalance: "0",
  });
  const oracle = makeMockOracle({ [BASE_WETH_ADDR]: 3500 });
  const agg = createWalletContextAggregator(env, { proxy, oracle });
  const r = await agg.getPublic(HOLDER, BASE);
  const weth = r.tokens.find((t) => t.address === BASE_WETH_ADDR);
  assert.equal(weth!.usdValue, 1750);
});

test("getPublic — native ETH balance + USD valuation via WETH price feed", async () => {
  const proxy = makeMockProxy({
    tokenBalances: {},
    nativeBalance: "2000000000000000000", // 2 ETH
  });
  const oracle = makeMockOracle({ [BASE_WETH_ADDR]: 3500 });
  const agg = createWalletContextAggregator(env, { proxy, oracle });
  const r = await agg.getPublic(HOLDER, BASE);
  assert.equal(r.native.balance, "2000000000000000000");
  assert.equal(r.native.priceUsd, 3500);
  assert.equal(r.native.usdValue, 7000);
});

test("getPublic — null price gives null usdValue (not 0)", async () => {
  const proxy = makeMockProxy({
    tokenBalances: { [BASE_USDC_ADDR]: "1000000" },
    nativeBalance: "0",
  });
  const oracle = makeMockOracle({}); // no prices
  const agg = createWalletContextAggregator(env, { proxy, oracle });
  const r = await agg.getPublic(HOLDER, BASE);
  const usdc = r.tokens.find((t) => t.address === BASE_USDC_ADDR);
  assert.equal(usdc!.priceUsd, null);
  assert.equal(usdc!.usdValue, null);
});

test("getPublic — totalUsd sums tokens + native correctly", async () => {
  const proxy = makeMockProxy({
    tokenBalances: { [BASE_USDC_ADDR]: "1000000" }, // 1 USDC = $1
    nativeBalance: "1000000000000000000", // 1 ETH = $3500
  });
  const oracle = makeMockOracle({ [BASE_USDC_ADDR]: 1.0, [BASE_WETH_ADDR]: 3500 });
  const agg = createWalletContextAggregator(env, { proxy, oracle });
  const r = await agg.getPublic(HOLDER, BASE);
  // Tokens summed: USDC 1 + WETH 0 + all other zero-balance tokens at their prices = 1
  // Plus native ETH @ 3500 = 3501
  assert.equal(r.totalUsd, 3501);
});

test("getShielded — reads UserBalance for the user, USD-enriches USDC", async () => {
  await UserBalance.create({
    address: HOLDER,
    chainId: BASE,
    assetKey: "8453:usdc",
    currency: "usdc",
    totalAmount: "5000000000",
  });
  const proxy = makeMockProxy({ tokenBalances: {}, nativeBalance: "0" });
  const oracle = makeMockOracle({ [BASE_USDC_ADDR]: 1.0 });
  const agg = createWalletContextAggregator(env, { proxy, oracle });
  const r = await agg.getShielded(HOLDER, BASE);
  assert.equal(r.balances.length, 1);
  const usdc = r.balances[0]!;
  assert.equal(usdc.currency, "usdc");
  assert.equal(usdc.amount, "5000000000");
  assert.equal(usdc.symbol, "USDC");
  assert.equal(usdc.usdValue, 5000);
  assert.equal(r.totalUsd, 5000);
});

test("getShielded — empty balances → totalUsd null", async () => {
  const proxy = makeMockProxy({ tokenBalances: {}, nativeBalance: "0" });
  const oracle = makeMockOracle({});
  const agg = createWalletContextAggregator(env, { proxy, oracle });
  const r = await agg.getShielded(HOLDER, BASE);
  assert.equal(r.balances.length, 0);
  assert.equal(r.totalUsd, null);
});

test("getShielded — zero-amount rows get filtered (no visual noise)", async () => {
  await UserBalance.create({
    address: HOLDER,
    chainId: BASE,
    assetKey: "8453:usdc",
    currency: "usdc",
    totalAmount: "0",
  });
  await UserBalance.create({
    address: HOLDER,
    chainId: BASE,
    assetKey: "8453:eth",
    currency: "eth",
    totalAmount: "0",
  });
  const proxy = makeMockProxy({ tokenBalances: {}, nativeBalance: "0" });
  const oracle = makeMockOracle({});
  const agg = createWalletContextAggregator(env, { proxy, oracle });
  const r = await agg.getShielded(HOLDER, BASE);
  assert.equal(r.balances.length, 0, "zero-amount shielded rows must not appear in the response");
});

test("getShielded — raw 0x address currency resolves to symbol via token list", async () => {
  // Some legacy UserBalance rows store the token contract address as `currency`
  // instead of a ledger key. The aggregator must look these up by address.
  await UserBalance.create({
    address: HOLDER,
    chainId: BASE,
    assetKey: `8453:${BASE_USDC_ADDR}`,
    currency: BASE_USDC_ADDR, // raw 0x address
    totalAmount: "5000000000",
  });
  const proxy = makeMockProxy({ tokenBalances: {}, nativeBalance: "0" });
  const oracle = makeMockOracle({ [BASE_USDC_ADDR]: 1.0 });
  const agg = createWalletContextAggregator(env, { proxy, oracle });
  const r = await agg.getShielded(HOLDER, BASE);
  assert.equal(r.balances.length, 1);
  const it = r.balances[0]!;
  // No 0x address in the symbol output — must be the token list symbol
  assert.equal(it.symbol, "USDC", `symbol should be 'USDC', got '${it.symbol}'`);
  assert.equal(it.usdValue, 5000);
});

test("getShielded — unknown 0x address currency renders as middle-ellipsis, not full hex", async () => {
  const unknownAddr = "0x000000000000000000000000000000000000dEaD";
  await UserBalance.create({
    address: HOLDER,
    chainId: BASE,
    assetKey: `8453:${unknownAddr.toLowerCase()}`,
    currency: unknownAddr,
    totalAmount: "1",
  });
  const proxy = makeMockProxy({ tokenBalances: {}, nativeBalance: "0" });
  const oracle = makeMockOracle({});
  const agg = createWalletContextAggregator(env, { proxy, oracle });
  const r = await agg.getShielded(HOLDER, BASE);
  assert.equal(r.balances.length, 1);
  const it = r.balances[0]!;
  // No full 40-char hex in the symbol — must be truncated
  assert.ok(
    !/0x[a-fA-F0-9]{40}/.test(it.symbol ?? ""),
    `unknown contract symbol must not be full address, got '${it.symbol}'`,
  );
  assert.ok((it.symbol ?? "").includes("…"), "should contain middle-ellipsis character");
});

test("getFull — combines shielded + public into a single totalUsd", async () => {
  await UserBalance.create({
    address: HOLDER,
    chainId: BASE,
    assetKey: "8453:usdc",
    currency: "usdc",
    totalAmount: "1000000000", // 1000 USDC shielded
  });
  const proxy = makeMockProxy({
    tokenBalances: { [BASE_USDC_ADDR]: "500000000" }, // 500 USDC public
    nativeBalance: "1000000000000000000", // 1 ETH public
  });
  const oracle = makeMockOracle({ [BASE_USDC_ADDR]: 1.0, [BASE_WETH_ADDR]: 3500 });
  const agg = createWalletContextAggregator(env, { proxy, oracle });
  const r = await agg.getFull(HOLDER, BASE);
  assert.equal(r.shielded.totalUsd, 1000);
  // public: 500 USDC + 1 ETH = 500 + 3500 = 4000
  assert.equal(r.public.totalUsd, 4000);
  assert.equal(r.totalUsd, 5000);
});

test("getFull — privacy block surfaces env values", async () => {
  const proxy = makeMockProxy({ tokenBalances: {}, nativeBalance: "0" });
  const oracle = makeMockOracle({});
  const agg = createWalletContextAggregator(env, { proxy, oracle });
  const r = await agg.getFull(HOLDER, BASE);
  assert.equal(r.privacy.batchWindowMs, env.RPC_POOL_BATCH_WINDOW_MS);
  assert.equal(r.privacy.decoyRatio, env.RPC_POOL_DECOY_RATIO);
});

test("getPublic — unsupported chain throws", async () => {
  const proxy = makeMockProxy({ tokenBalances: {}, nativeBalance: "0" });
  const oracle = makeMockOracle({});
  const agg = createWalletContextAggregator(env, { proxy, oracle });
  await assert.rejects(() => agg.getPublic(HOLDER, 137), /Unsupported chain/);
});

test("getShielded — only returns the requested holder's balances", async () => {
  const other = "0x0000000000000000000000000000000000000bbb";
  await UserBalance.create({
    address: HOLDER,
    chainId: BASE,
    assetKey: "8453:usdc",
    currency: "usdc",
    totalAmount: "100",
  });
  await UserBalance.create({
    address: other,
    chainId: BASE,
    assetKey: "8453:usdc",
    currency: "usdc",
    totalAmount: "999999",
  });
  const proxy = makeMockProxy({ tokenBalances: {}, nativeBalance: "0" });
  const oracle = makeMockOracle({ [BASE_USDC_ADDR]: 1.0 });
  const agg = createWalletContextAggregator(env, { proxy, oracle });
  const r = await agg.getShielded(HOLDER, BASE);
  assert.equal(r.balances.length, 1);
  assert.equal(r.balances[0]!.amount, "100"); // not the other user's
});
