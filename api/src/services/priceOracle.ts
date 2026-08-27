import type { Redis } from "ioredis";
import type { Env } from "../config/env.js";
import type { TokenListEntry } from "../util/tokenLists.js";

/**
 * priceOracle — USD price enrichment for wallet-context responses.
 *
 * Adapter chain:
 *   1. Pyth Hermes (primary) — low-latency feeds for top-20 symbols
 *   2. CoinGecko (fallback) — full coverage for everything else
 *
 * Results are Redis-cached per symbol (TTL PRICE_CACHE_TTL_S, default 30s)
 * so a 100-user fan-out costs at most one upstream call per distinct symbol
 * per cache window.
 *
 * Hard rule: this module NEVER makes per-user, per-address requests upstream.
 * Inputs are always token entries (symbol + coingeckoId) — never wallet
 * addresses. There is no path from a holder address to a Pyth/CoinGecko log line.
 */

/**
 * Pyth Hermes feed IDs for the top-20 symbols in our token list.
 * Sourced from https://pyth.network/developers/price-feed-ids (mainnet crypto).
 * Add new entries when a token is added to the lists if Pyth covers it.
 */
const PYTH_FEED_IDS: Readonly<Record<string, string>> = {
  "Crypto.ETH/USD": "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  "Crypto.BTC/USD": "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  "Crypto.USDC/USD": "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  "Crypto.USDT/USD": "0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
  "Crypto.DAI/USD": "0xb0948a5e5313200c632b51bb5ca32f6de0d36e9950a942d19751e833f70dabfd",
  "Crypto.LINK/USD": "0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221",
  "Crypto.AAVE/USD": "0x2b9ab1e972a281585084148ba1389800799bd4be63b957507db1349314e47445",
  "Crypto.UNI/USD": "0x78d185a741d07edb3412b09008b7c5cfb9bbbd7d568bf00ba737b456ba171501",
  "Crypto.MKR/USD": "0x9375299e31c0deb9c6bc378e6329aab44cb48ec655552a70d4b9050346a30378",
  "Crypto.LDO/USD": "0xc63e2a7f37a04e5e614c07238bedb25dcc38927fba8fe890597a593c0b2fa4ad",
  "Crypto.CRV/USD": "0xa19d04ac696c7a6616d291c7e5d1377cc8be437c327b75adb5dc1bad745fcae8",
  "Crypto.COMP/USD": "0x4a8e42861cabc5ecb50996f92e7cfa2bce3fd0a2423b0c44c9b423fb2bd25478",
  "Crypto.CBETH/USD": "0x15ecddd26d49e1a8f1de9376ebebc03916ede873447c1255d2d5891b92ce5717",
  "Crypto.WSTETH/USD": "0x6df640f3b8963d8f8358f791f352b8364513f6ab1cca5ed3f1f7b5448980e784",
  "Crypto.STETH/USD": "0x846ae1bdb6300b817cee5fdee2a6da192775030db5615b94a465f53bd40850b5",
  "Crypto.RETH/USD": "0xa0255134973f4fdf2f8f7808354274a3b1ebc6ee438be898d045e8b56ba1fe13",
  "Crypto.EURC/USD": "0x76fa85158bf14ede77087fe3ae472f66213f6ea2f5b411cb2de472794990fa5c",
  "Crypto.SHIB/USD": "0xf0d57deca57b3da2fe63a493f4c25925fdfd8edf834b20f93e1f84dbd1504d4a",
  "Crypto.PEPE/USD": "0xd69731a2e74ac1ce884fc3890f7ee324b6deb66147055249568869ed700882e4",
};

export interface PriceResult {
  /** USD price; null when neither Pyth nor CoinGecko returned a value. */
  readonly priceUsd: number | null;
  /** Where this price came from. `null` when no source returned. */
  readonly source: "pyth" | "coingecko" | "cache" | "fixed" | null;
  /** Unix ms when the underlying source value was observed. */
  readonly at: number;
}

export interface PriceOracle {
  /** Get a single token's USD price (cached). */
  getPriceUsd(token: TokenListEntry): Promise<PriceResult>;
  /** Batch — one Pyth + one CoinGecko request total for the whole input set. */
  getPricesUsd(tokens: ReadonlyArray<TokenListEntry>): Promise<Map<string, PriceResult>>;
  /** Probe health of both adapters. */
  health(): Promise<{ ok: boolean; pyth: boolean; coingecko: boolean }>;
}

export interface CreatePriceOracleOptions {
  readonly redis?: Redis;
  /** Override for tests — swap window.fetch with a stub. */
  readonly fetchImpl?: typeof fetch;
  /** Override the system clock for cache TTL tests. */
  readonly now?: () => number;
}

interface PythPriceFeedV2Response {
  parsed?: Array<{
    id: string;
    price: { price: string; expo: number; publish_time: number; conf: string };
  }>;
}

interface CoinGeckoSimplePriceResponse {
  [coinId: string]: { usd?: number };
}

export function createPriceOracle(
  env: Env,
  opts: CreatePriceOracleOptions = {},
): PriceOracle {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.now ?? Date.now;
  const redis = opts.redis;

  function cacheKey(tokenKey: string): string {
    return `price:${tokenKey.toLowerCase()}`;
  }

  async function getCached(tokenKey: string): Promise<PriceResult | undefined> {
    if (!redis) return undefined;
    const raw = await redis.get(cacheKey(tokenKey));
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as PriceResult;
      // Reissue with `cache` source so downstream can tell it was reused
      return { priceUsd: parsed.priceUsd, source: "cache", at: parsed.at };
    } catch {
      return undefined;
    }
  }

  async function setCache(tokenKey: string, value: PriceResult): Promise<void> {
    if (!redis) return;
    const ttl = env.PRICE_CACHE_TTL_S;
    if (ttl <= 0) return;
    await redis.set(cacheKey(tokenKey), JSON.stringify(value), "EX", ttl);
  }

  /**
   * Fetch from Pyth Hermes. Returns map of pythSymbol → priceUsd.
   * Missing IDs are silently absent.
   */
  async function fetchPyth(
    pythSymbols: ReadonlyArray<string>,
  ): Promise<Map<string, { priceUsd: number; at: number }>> {
    const out = new Map<string, { priceUsd: number; at: number }>();
    if (pythSymbols.length === 0) return out;
    const idToSymbol = new Map<string, string>();
    const ids: string[] = [];
    for (const sym of pythSymbols) {
      const id = PYTH_FEED_IDS[sym];
      if (id) {
        ids.push(id);
        idToSymbol.set(id.toLowerCase(), sym);
      }
    }
    if (ids.length === 0) return out;

    const url = new URL(`${env.PYTH_HERMES_URL.replace(/\/$/, "")}/v2/updates/price/latest`);
    for (const id of ids) url.searchParams.append("ids[]", id);

    const res = await doFetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`pyth hermes ${res.status}`);
    const body = (await res.json()) as PythPriceFeedV2Response;
    for (const p of body.parsed ?? []) {
      const sym = idToSymbol.get(`0x${p.id.toLowerCase().replace(/^0x/, "")}`);
      if (!sym) continue;
      const num = Number(p.price.price);
      const expo = p.price.expo;
      const priceUsd = num * Math.pow(10, expo);
      if (!Number.isFinite(priceUsd) || priceUsd < 0) continue;
      out.set(sym, { priceUsd, at: p.price.publish_time * 1000 });
    }
    return out;
  }

  /**
   * Fetch from CoinGecko simple/price. Returns map of coingeckoId → priceUsd.
   */
  async function fetchCoinGecko(
    coingeckoIds: ReadonlyArray<string>,
  ): Promise<Map<string, { priceUsd: number; at: number }>> {
    const out = new Map<string, { priceUsd: number; at: number }>();
    if (coingeckoIds.length === 0) return out;
    const url = new URL("https://api.coingecko.com/api/v3/simple/price");
    url.searchParams.set("ids", coingeckoIds.join(","));
    url.searchParams.set("vs_currencies", "usd");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (env.COINGECKO_API_KEY) headers["x-cg-pro-api-key"] = env.COINGECKO_API_KEY;
    const res = await doFetch(url, { method: "GET", headers });
    if (!res.ok) throw new Error(`coingecko ${res.status}`);
    const body = (await res.json()) as CoinGeckoSimplePriceResponse;
    const ts = now();
    for (const [id, val] of Object.entries(body)) {
      const usd = val.usd;
      if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) continue;
      out.set(id, { priceUsd: usd, at: ts });
    }
    return out;
  }

  async function getPricesUsd(
    tokens: ReadonlyArray<TokenListEntry>,
  ): Promise<Map<string, PriceResult>> {
    const results = new Map<string, PriceResult>();
    if (tokens.length === 0) return results;

    // 0) Fixed-price tokens (test-only pegged mocks) — never touch cache or network.
    const unfixed: TokenListEntry[] = [];
    for (const t of tokens) {
      if (t.fixedUsd !== undefined) {
        results.set(t.address, { priceUsd: t.fixedUsd, source: "fixed", at: now() });
      } else {
        unfixed.push(t);
      }
    }
    if (unfixed.length === 0) return results;

    // 1) Probe cache for everything first
    const remaining: TokenListEntry[] = [];
    for (const t of unfixed) {
      const cached = await getCached(t.address);
      if (cached) {
        results.set(t.address, cached);
      } else {
        remaining.push(t);
      }
    }
    if (remaining.length === 0) return results;

    // 2) Pyth fan-in (only tokens that have a pythSymbol)
    const pythCandidates = remaining.filter((t) => t.pythSymbol);
    let pythMap = new Map<string, { priceUsd: number; at: number }>();
    if (pythCandidates.length > 0) {
      try {
        pythMap = await fetchPyth(pythCandidates.map((t) => t.pythSymbol!));
      } catch (e) {
        console.warn("[veiledhood-context] pyth fetch failed:", (e as Error).message);
      }
    }

    // 3) CoinGecko fan-in for whatever Pyth missed (and tokens without pythSymbol)
    const stillNeeded: TokenListEntry[] = [];
    for (const t of remaining) {
      const fromPyth = t.pythSymbol ? pythMap.get(t.pythSymbol) : undefined;
      if (fromPyth) {
        const value: PriceResult = { priceUsd: fromPyth.priceUsd, source: "pyth", at: fromPyth.at };
        results.set(t.address, value);
        await setCache(t.address, value);
      } else if (t.coingeckoId) {
        stillNeeded.push(t);
      } else {
        const value: PriceResult = { priceUsd: null, source: null, at: now() };
        results.set(t.address, value);
      }
    }

    if (stillNeeded.length > 0) {
      const ids = Array.from(new Set(stillNeeded.map((t) => t.coingeckoId!)));
      let gMap = new Map<string, { priceUsd: number; at: number }>();
      try {
        gMap = await fetchCoinGecko(ids);
      } catch (e) {
        console.warn("[veiledhood-context] coingecko fetch failed:", (e as Error).message);
      }
      for (const t of stillNeeded) {
        const fromGecko = gMap.get(t.coingeckoId!);
        const value: PriceResult = fromGecko
          ? { priceUsd: fromGecko.priceUsd, source: "coingecko", at: fromGecko.at }
          : { priceUsd: null, source: null, at: now() };
        results.set(t.address, value);
        if (value.priceUsd !== null) {
          await setCache(t.address, value);
        }
      }
    }

    return results;
  }

  async function getPriceUsd(token: TokenListEntry): Promise<PriceResult> {
    const map = await getPricesUsd([token]);
    return map.get(token.address) ?? { priceUsd: null, source: null, at: now() };
  }

  async function health(): Promise<{ ok: boolean; pyth: boolean; coingecko: boolean }> {
    let pyth = false;
    let coingecko = false;
    try {
      const url = new URL(`${env.PYTH_HERMES_URL.replace(/\/$/, "")}/v2/updates/price/latest`);
      url.searchParams.append("ids[]", PYTH_FEED_IDS["Crypto.ETH/USD"]!);
      const res = await doFetch(url, { method: "GET" });
      pyth = res.ok;
    } catch {
      pyth = false;
    }
    try {
      const res = await doFetch("https://api.coingecko.com/api/v3/ping");
      coingecko = res.ok;
    } catch {
      coingecko = false;
    }
    return { ok: pyth || coingecko, pyth, coingecko };
  }

  return { getPriceUsd, getPricesUsd, health };
}

export { PYTH_FEED_IDS };
