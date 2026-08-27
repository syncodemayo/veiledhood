import { test } from "node:test";
import assert from "node:assert/strict";
import type { PublicClient, Transport, Chain } from "viem";
import { base } from "viem/chains";
import { createPooledRpcProxy, DECOY_ADDRESSES } from "./pooledRpcProxy.js";
import type { Env } from "../config/env.js";
import type { TokenListEntry } from "../util/tokenLists.js";

/**
 * Load/concurrency tests for pooledRpcProxy — confirms the privacy + batching
 * properties hold under a realistic concurrent-request burst, not just one-shot.
 *
 * These are NOT a full k6 load test. They run in-process against a fake viem
 * client to measure batching coalesce + decoy distribution at N=100 concurrent
 * callers. A real RPC-burning load test happens in staging during soak.
 */

interface MulticallCall {
  contracts: ReadonlyArray<{
    address: `0x${string}`;
    functionName: string;
    args: readonly unknown[];
  }>;
  multicallAddress: string;
  allowFailure: boolean;
}

interface CountingFake {
  multicallCalls: MulticallCall[];
  totalContractsSeen: number;
  client: PublicClient<Transport, Chain>;
}

function makeCountingFake(): CountingFake {
  const state: CountingFake = {
    multicallCalls: [],
    totalContractsSeen: 0,
    client: undefined as unknown as PublicClient<Transport, Chain>,
  };
  state.client = {
    multicall: async (args: unknown) => {
      const typed = args as MulticallCall;
      state.multicallCalls.push(typed);
      state.totalContractsSeen += typed.contracts.length;
      return typed.contracts.map(() => ({ status: "success" as const, result: 1n }));
    },
    getBalance: async () => 0n,
  } as unknown as PublicClient<Transport, Chain>;
  return state;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    MONGODB_URI: "x",
    JWT_SECRET: "x".repeat(16),
    JWT_EXPIRES_IN: "7d",
    PORT: 3000,
    BASE_CHAIN_ID: 8453,
    RPC_URL: "http://fake",
    ETH_RPC_URL: undefined,
    BASE_RPC_URL_FALLBACK: undefined,
    ETH_RPC_URL_FALLBACK: undefined,
    RPC_POOL_BATCH_WINDOW_MS: 50,
    RPC_POOL_DECOY_RATIO: 0,
    RPC_POOL_JITTER_MAX_MS: 0,
    RPC_POOL_FAILOVER_ERROR_THRESHOLD: 5,
    RPC_POOL_FAILOVER_WINDOW_S: 30,
    PYTH_HERMES_URL: "https://hermes.pyth.network",
    PRICE_CACHE_TTL_S: 30,
    AI_RATE_LIMIT_PER_USER_PER_DAY: 50,
    AI_RATE_LIMIT_PER_USER_PER_MIN: 5,
    AI_MODEL_WHITELIST: "x",
    TOR_SOCKS_HOST: "127.0.0.1",
    TOR_SOCKS_PORT: 9050,
    TOR_ENABLED: false,
    REDIS_URL: "redis://127.0.0.1:6379",
    AI_RATE_LIMIT_DISABLED: false,
    AGENTS_RATE_LIMIT_PER_USER_PER_MIN: 30,
    AGENTS_RATE_LIMIT_PER_USER_PER_DAY: 500,
    AGENTS_MAX_PER_USER: 20,
    AGENTS_MAX_CIPHERTEXT_BYTES: 16384,
    AGENTS_RATE_LIMIT_DISABLED: false,
    CONTEXT_RATE_LIMIT_PER_USER_PER_MIN: 30,
    CONTEXT_RATE_LIMIT_PER_USER_PER_DAY: 1000,
    CONTEXT_RATE_LIMIT_DISABLED: false,
    CONTEXT_CACHE_TTL_S: 60,
    INDEXER_LOG_CHUNK_BLOCKS: 10,
    MERKLE_INDEXER_FROM_BLOCK: 0,
    VEILEDHOOD_ETH_TRANSFER_FEE_BPS: 0,
    VEILEDHOOD_ETH_TRANSFER_FEE_FIXED: "0",
    WITHDRAW_DEADLINE_MAX_SEC: 900,
    VEILSWAP_FEE_BPS: 0,
    VEILSWAP_FEE_FIXED_ETH: "0",
    INDEXER_DISABLED: false as unknown as boolean,
    transferFeeConfig: {},
    ...overrides,
  } as unknown as Env;
}

function randAddr(): string {
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const TOKENS: TokenListEntry[] = [
  { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", name: "USD Coin", decimals: 6 },
  { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
];

test("100 concurrent callers in one batch window → 1 multicall (cross-user coalesce)", async () => {
  const fake = makeCountingFake();
  const proxy = createPooledRpcProxy(makeEnv(), { buildClient: () => fake.client });

  // Fire 100 callers at once, all within the 50ms batching window
  const callers = Array.from({ length: 100 }, () =>
    proxy.getBalances(base.id, randAddr(), TOKENS),
  );
  const results = await Promise.all(callers);

  assert.equal(results.length, 100);
  for (const r of results) {
    assert.equal(r.length, 2);
  }
  // The privacy property: a single multicall covers all 100 callers
  assert.equal(
    fake.multicallCalls.length,
    1,
    `expected 1 multicall, got ${fake.multicallCalls.length}`,
  );
  // Total contracts = 100 callers × 2 tokens = 200
  assert.equal(fake.totalContractsSeen, 200);
});

test("decoy ratio 0.10 over 1000 real calls → roughly 100 decoys, drawn from pool", async () => {
  const fake = makeCountingFake();
  const proxy = createPooledRpcProxy(
    makeEnv({ RPC_POOL_DECOY_RATIO: 0.1, RPC_POOL_BATCH_WINDOW_MS: 5 }),
    { buildClient: () => fake.client },
  );

  // 500 individual calls (each with 2 tokens, so 1000 real reads).
  // We don't batch into 1 here because we want many batches firing,
  // so decoy injection statistics show up clearly.
  const callers = Array.from({ length: 500 }, () =>
    proxy.getBalances(base.id, randAddr(), TOKENS),
  );
  await Promise.all(callers);

  // Total real contracts: 500 callers × 2 tokens = 1000
  // Expected decoys: 0.1 * 1000 = 100 (target). Per-batch flooring may give us
  // a bit less; allow a wide tolerance for statistical jitter.
  const totalDispatched = fake.multicallCalls.reduce((s, c) => s + c.contracts.length, 0);
  const realCalls = 1000;
  const decoyCount = totalDispatched - realCalls;

  // Conservative bounds — anywhere between 5% and 15% counts as a healthy 10% target.
  // The Math.floor(realCallCount * ratio) per-batch math makes the achieved decoy
  // ratio sit slightly below the configured ratio.
  assert.ok(
    decoyCount >= realCalls * 0.05,
    `decoy count too low: ${decoyCount} (expected ≥ ${realCalls * 0.05})`,
  );
  assert.ok(
    decoyCount <= realCalls * 0.15,
    `decoy count too high: ${decoyCount} (expected ≤ ${realCalls * 0.15})`,
  );

  // Spot-check: at least one dispatched decoy holder must be from the pool
  const decoyPool = new Set(DECOY_ADDRESSES);
  let seenDecoyFromPool = false;
  for (const call of fake.multicallCalls) {
    for (const c of call.contracts) {
      const holder = String(c.args[0]).toLowerCase();
      if (decoyPool.has(holder)) {
        seenDecoyFromPool = true;
        break;
      }
    }
    if (seenDecoyFromPool) break;
  }
  assert.ok(seenDecoyFromPool, "no decoys observed from the configured pool");
});

test("multicall coalesce holds across a stress burst (zero crashes, correct totals)", async () => {
  const fake = makeCountingFake();
  const proxy = createPooledRpcProxy(
    makeEnv({ RPC_POOL_BATCH_WINDOW_MS: 25 }),
    { buildClient: () => fake.client },
  );

  // Drive 5 sequential bursts of 50 concurrent callers each
  for (let burst = 0; burst < 5; burst++) {
    const callers = Array.from({ length: 50 }, () =>
      proxy.getBalances(base.id, randAddr(), TOKENS),
    );
    await Promise.all(callers);
  }

  // 5 bursts × 50 callers × 2 tokens = 500 real reads.
  // Expect ~5 multicalls (one per burst), but allow ≤10 to absorb timing jitter.
  assert.ok(fake.multicallCalls.length <= 10, `expected ≤10 multicalls, got ${fake.multicallCalls.length}`);
  assert.ok(fake.multicallCalls.length >= 1, "expected ≥1 multicall");
  assert.equal(fake.totalContractsSeen, 500, "expected exactly 500 real contract calls (no decoys configured)");
});

test("no observable wallet address appears as `from` field across 100 concurrent calls", async () => {
  const fake = makeCountingFake();
  const proxy = createPooledRpcProxy(makeEnv(), { buildClient: () => fake.client });
  await Promise.all(
    Array.from({ length: 100 }, () => proxy.getBalances(base.id, randAddr(), TOKENS)),
  );
  for (const call of fake.multicallCalls) {
    for (const c of call.contracts) {
      // `args` for balanceOf is [holder]. We expect the args[0] (holder) to be
      // a 40-hex address, but the contract entry itself must NOT carry a `from` field.
      assert.equal((c as { from?: string }).from, undefined, "contract entry must not include `from`");
    }
  }
});
