import { test } from "node:test";
import assert from "node:assert/strict";
import { createPriceOracle, PYTH_FEED_IDS } from "./priceOracle.js";
import type { Env } from "../config/env.js";
import type { TokenListEntry } from "../util/tokenLists.js";

// ---------- helpers ----------

interface FakeFetchCall {
  url: string;
  method: string;
  headers?: Record<string, string>;
}

interface FakeFetchState {
  calls: FakeFetchCall[];
  responses: Array<{ status: number; body: unknown } | Error>;
}

function makeFakeFetch(state: FakeFetchState): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.toString() : String(input);
    state.calls.push({
      url,
      method: init?.method ?? "GET",
      headers: init?.headers as Record<string, string> | undefined,
    });
    const next = state.responses.shift();
    if (!next) throw new Error("fake fetch: no responses queued");
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    PYTH_HERMES_URL: "https://hermes.pyth.network",
    COINGECKO_API_KEY: undefined,
    PRICE_CACHE_TTL_S: 30,
    ...overrides,
  } as unknown as Env;
}

function makePythResponse(entries: Array<{ feedId: string; price: string; expo: number; at: number }>) {
  return {
    status: 200,
    body: {
      parsed: entries.map((e) => ({
        id: e.feedId.replace(/^0x/, ""),
        price: { price: e.price, expo: e.expo, publish_time: e.at, conf: "0" },
      })),
    },
  };
}

const USDC: TokenListEntry = {
  address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  coingeckoId: "usd-coin",
  pythSymbol: "Crypto.USDC/USD",
};

const WETH: TokenListEntry = {
  address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  symbol: "WETH",
  name: "Wrapped Ether",
  decimals: 18,
  coingeckoId: "weth",
  pythSymbol: "Crypto.ETH/USD",
};

const AERO_NO_PYTH: TokenListEntry = {
  address: "0x940181a94a35a4569e4529a3cdfb74e38fd98631",
  symbol: "AERO",
  name: "Aerodrome",
  decimals: 18,
  coingeckoId: "aerodrome-finance",
  // no pythSymbol → forces CoinGecko path
};

// ---------- tests ----------

test("Pyth ID map includes ETH, BTC, USDC, USDT", () => {
  assert.ok(PYTH_FEED_IDS["Crypto.ETH/USD"]);
  assert.ok(PYTH_FEED_IDS["Crypto.BTC/USD"]);
  assert.ok(PYTH_FEED_IDS["Crypto.USDC/USD"]);
  assert.ok(PYTH_FEED_IDS["Crypto.USDT/USD"]);
});

test("getPricesUsd — Pyth primary returns prices with correct scaling", async () => {
  const state: FakeFetchState = { calls: [], responses: [] };
  state.responses.push(
    makePythResponse([
      { feedId: PYTH_FEED_IDS["Crypto.USDC/USD"]!, price: "99980000", expo: -8, at: 1_700_000_000 },
      { feedId: PYTH_FEED_IDS["Crypto.ETH/USD"]!, price: "350025000000", expo: -8, at: 1_700_000_000 },
    ]),
  );

  const oracle = createPriceOracle(makeEnv(), { fetchImpl: makeFakeFetch(state) });
  const out = await oracle.getPricesUsd([USDC, WETH]);

  assert.equal(out.get(USDC.address)!.priceUsd!.toFixed(4), "0.9998");
  assert.equal(out.get(WETH.address)!.priceUsd, 3500.25);
  assert.equal(out.get(USDC.address)!.source, "pyth");
});

test("getPricesUsd — one Pyth call batches multiple symbols", async () => {
  const state: FakeFetchState = { calls: [], responses: [] };
  state.responses.push(
    makePythResponse([
      { feedId: PYTH_FEED_IDS["Crypto.USDC/USD"]!, price: "1", expo: 0, at: 1_700_000_000 },
      { feedId: PYTH_FEED_IDS["Crypto.ETH/USD"]!, price: "3500", expo: 0, at: 1_700_000_000 },
    ]),
  );
  const oracle = createPriceOracle(makeEnv(), { fetchImpl: makeFakeFetch(state) });
  await oracle.getPricesUsd([USDC, WETH]);
  assert.equal(state.calls.length, 1, "expected exactly one upstream call");
  assert.match(state.calls[0]!.url, /hermes\.pyth\.network/);
});

test("getPricesUsd — CoinGecko fallback when token has no pythSymbol", async () => {
  const state: FakeFetchState = { calls: [], responses: [] };
  // No Pyth candidates → Pyth call is skipped entirely. Only CoinGecko fires.
  state.responses.push({
    status: 200,
    body: { "aerodrome-finance": { usd: 0.45 } },
  });

  const oracle = createPriceOracle(makeEnv(), { fetchImpl: makeFakeFetch(state) });
  const out = await oracle.getPricesUsd([AERO_NO_PYTH]);
  assert.equal(out.get(AERO_NO_PYTH.address)!.priceUsd, 0.45);
  assert.equal(out.get(AERO_NO_PYTH.address)!.source, "coingecko");
  assert.equal(state.calls.length, 1, "only CoinGecko should have been called");
  assert.match(state.calls[0]!.url, /coingecko/);
});

test("getPricesUsd — CoinGecko covers Pyth misses", async () => {
  const state: FakeFetchState = { calls: [], responses: [] };
  // Pyth returns ETH but not USDC
  state.responses.push(
    makePythResponse([
      { feedId: PYTH_FEED_IDS["Crypto.ETH/USD"]!, price: "3500", expo: 0, at: 1_700_000_000 },
    ]),
  );
  // CoinGecko returns USDC
  state.responses.push({ status: 200, body: { "usd-coin": { usd: 1.0 } } });

  const oracle = createPriceOracle(makeEnv(), { fetchImpl: makeFakeFetch(state) });
  const out = await oracle.getPricesUsd([USDC, WETH]);
  assert.equal(out.get(WETH.address)!.source, "pyth");
  assert.equal(out.get(USDC.address)!.source, "coingecko");
  assert.equal(out.get(USDC.address)!.priceUsd, 1.0);
});

test("getPricesUsd — both fail → null priceUsd, source null", async () => {
  const state: FakeFetchState = { calls: [], responses: [] };
  state.responses.push(new Error("pyth down"));
  state.responses.push(new Error("coingecko down"));
  const oracle = createPriceOracle(makeEnv(), { fetchImpl: makeFakeFetch(state) });
  const out = await oracle.getPricesUsd([USDC]);
  assert.equal(out.get(USDC.address)!.priceUsd, null);
  assert.equal(out.get(USDC.address)!.source, null);
});

test("getPricesUsd — empty input returns empty map without upstream calls", async () => {
  const state: FakeFetchState = { calls: [], responses: [] };
  const oracle = createPriceOracle(makeEnv(), { fetchImpl: makeFakeFetch(state) });
  const out = await oracle.getPricesUsd([]);
  assert.equal(out.size, 0);
  assert.equal(state.calls.length, 0);
});

test("CoinGecko API key is sent as x-cg-pro-api-key header when present", async () => {
  const state: FakeFetchState = { calls: [], responses: [] };
  state.responses.push(makePythResponse([])); // no pyth coverage
  state.responses.push({ status: 200, body: { "aerodrome-finance": { usd: 0.5 } } });

  const oracle = createPriceOracle(makeEnv({ COINGECKO_API_KEY: "test-key" }), {
    fetchImpl: makeFakeFetch(state),
  });
  await oracle.getPricesUsd([AERO_NO_PYTH]);
  const geckoCall = state.calls.find((c) => c.url.includes("coingecko"));
  assert.ok(geckoCall);
  assert.equal(geckoCall!.headers?.["x-cg-pro-api-key"], "test-key");
});

test("priceOracle never sends the token contract address upstream (privacy invariant)", async () => {
  // Pyth feed IDs are 64-hex (not 40-hex addresses) so we assert against the
  // token's actual contract address — that must never appear in any URL.
  const state: FakeFetchState = { calls: [], responses: [] };
  state.responses.push(
    makePythResponse([
      { feedId: PYTH_FEED_IDS["Crypto.USDC/USD"]!, price: "1", expo: 0, at: 1_700_000_000 },
    ]),
  );
  const oracle = createPriceOracle(makeEnv(), { fetchImpl: makeFakeFetch(state) });
  await oracle.getPricesUsd([USDC]);
  for (const c of state.calls) {
    assert.doesNotMatch(
      c.url,
      new RegExp(USDC.address.replace(/^0x/, "0x"), "i"),
      `URL must not embed token contract address: ${c.url}`,
    );
  }
});

test("getPriceUsd — single-token convenience wrapper", async () => {
  const state: FakeFetchState = { calls: [], responses: [] };
  state.responses.push(
    makePythResponse([
      { feedId: PYTH_FEED_IDS["Crypto.USDC/USD"]!, price: "1", expo: 0, at: 1_700_000_000 },
    ]),
  );
  const oracle = createPriceOracle(makeEnv(), { fetchImpl: makeFakeFetch(state) });
  const r = await oracle.getPriceUsd(USDC);
  assert.equal(r.priceUsd, 1);
  assert.equal(r.source, "pyth");
});

test("cache — second call within TTL uses cached values (skips upstream)", async () => {
  const cacheStore = new Map<string, string>();
  const fakeRedis = {
    get: async (k: string) => cacheStore.get(k) ?? null,
    set: async (k: string, v: string, _ex: "EX", _ttl: number) => {
      cacheStore.set(k, v);
      return "OK";
    },
  } as unknown as import("ioredis").Redis;

  const state: FakeFetchState = { calls: [], responses: [] };
  state.responses.push(
    makePythResponse([
      { feedId: PYTH_FEED_IDS["Crypto.USDC/USD"]!, price: "1", expo: 0, at: 1_700_000_000 },
    ]),
  );

  const oracle = createPriceOracle(makeEnv(), { fetchImpl: makeFakeFetch(state), redis: fakeRedis });
  const first = await oracle.getPricesUsd([USDC]);
  const second = await oracle.getPricesUsd([USDC]);

  assert.equal(first.get(USDC.address)!.source, "pyth");
  assert.equal(second.get(USDC.address)!.source, "cache");
  assert.equal(state.calls.length, 1, "second call should not hit upstream");
});

test("Pyth Hermes URL respects env override", async () => {
  const state: FakeFetchState = { calls: [], responses: [] };
  state.responses.push(makePythResponse([]));
  const env = makeEnv({ PYTH_HERMES_URL: "https://hermes-staging.example/" });
  const oracle = createPriceOracle(env, { fetchImpl: makeFakeFetch(state) });
  await oracle.getPricesUsd([USDC]);
  assert.match(state.calls[0]!.url, /hermes-staging\.example/);
});

test("rejects negative or non-finite Pyth prices", async () => {
  const state: FakeFetchState = { calls: [], responses: [] };
  state.responses.push(
    makePythResponse([
      { feedId: PYTH_FEED_IDS["Crypto.USDC/USD"]!, price: "-1", expo: 0, at: 1_700_000_000 },
    ]),
  );
  state.responses.push({ status: 200, body: { "usd-coin": { usd: 1.0 } } });
  const oracle = createPriceOracle(makeEnv(), { fetchImpl: makeFakeFetch(state) });
  const out = await oracle.getPricesUsd([USDC]);
  // Pyth was rejected, CoinGecko succeeded
  assert.equal(out.get(USDC.address)!.source, "coingecko");
  assert.equal(out.get(USDC.address)!.priceUsd, 1.0);
});
