import { test } from "node:test";
import assert from "node:assert/strict";
import type { PublicClient, Transport, Chain } from "viem";
import { base, mainnet } from "viem/chains";
import {
  createPooledRpcProxy,
  MULTICALL3_ADDRESS,
  DECOY_ADDRESSES,
} from "./pooledRpcProxy.js";
import type { Env } from "../config/env.js";
import type { TokenListEntry } from "../util/tokenLists.js";

// ---------- helpers ----------

interface MulticallCall {
  contracts: ReadonlyArray<{
    address: `0x${string}`;
    functionName: string;
    args: readonly unknown[];
  }>;
  multicallAddress: string;
  allowFailure: boolean;
}

interface FakeClient {
  multicallCalls: MulticallCall[];
  multicallResponses: Array<(args: unknown) => Array<{ status: "success" | "failure"; result?: bigint }>>;
  getBalanceResponses: Array<bigint | Error>;
  getBalanceCalls: Array<string>;
  fail?: boolean;
}

function makeFakeClient(): { client: PublicClient<Transport, Chain>; fake: FakeClient } {
  const fake: FakeClient = {
    multicallCalls: [],
    multicallResponses: [],
    getBalanceResponses: [],
    getBalanceCalls: [],
  };
  const client = {
    multicall: async (args: unknown) => {
      const typed = args as MulticallCall;
      fake.multicallCalls.push(typed);
      if (fake.fail) throw new Error("multicall RPC error");
      // Default response: every contract returns 1234n
      const responder = fake.multicallResponses.shift();
      if (responder) return responder(args);
      return typed.contracts.map(() => ({ status: "success" as const, result: 1234n }));
    },
    getBalance: async (args: { address: string }) => {
      fake.getBalanceCalls.push(args.address);
      const next = fake.getBalanceResponses.shift();
      if (next instanceof Error) throw next;
      return next ?? 0n;
    },
  } as unknown as PublicClient<Transport, Chain>;
  return { client, fake };
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  // Minimal env stub covering the fields pooledRpcProxy reads
  return {
    MONGODB_URI: "x",
    JWT_SECRET: "x".repeat(16),
    JWT_EXPIRES_IN: "7d",
    PORT: 3000,
    BASE_CHAIN_ID: 8453,
    RPC_URL: "http://fake-base",
    ETH_RPC_URL: "http://fake-eth",
    BASE_RPC_URL_FALLBACK: undefined,
    ETH_RPC_URL_FALLBACK: undefined,
    RPC_POOL_BATCH_WINDOW_MS: 25,
    RPC_POOL_DECOY_RATIO: 0,
    RPC_POOL_JITTER_MAX_MS: 0,
    RPC_POOL_FAILOVER_ERROR_THRESHOLD: 3,
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

const HOLDER_A = "0x0000000000000000000000000000000000000aaa";
const HOLDER_B = "0x0000000000000000000000000000000000000bbb";

const SAMPLE_TOKENS: TokenListEntry[] = [
  {
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
  },
  {
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
  },
];

// ---------- tests ----------

test("getBalances — single user returns balances in token order", async () => {
  const { client, fake } = makeFakeClient();
  fake.multicallResponses.push(() => [
    { status: "success", result: 5_000_000n },
    { status: "success", result: 250_000_000_000_000_000n },
  ]);

  const proxy = createPooledRpcProxy(makeEnv(), { buildClient: () => client });
  const result = await proxy.getBalances(base.id, HOLDER_A, SAMPLE_TOKENS);

  assert.equal(result.length, 2);
  assert.equal(result[0]!.symbol, "USDC");
  assert.equal(result[0]!.balance, "5000000");
  assert.equal(result[1]!.symbol, "WETH");
  assert.equal(result[1]!.balance, "250000000000000000");
});

test("multicall uses MULTICALL3_ADDRESS + allowFailure: true", async () => {
  const { client, fake } = makeFakeClient();
  const proxy = createPooledRpcProxy(makeEnv(), { buildClient: () => client });
  await proxy.getBalances(base.id, HOLDER_A, SAMPLE_TOKENS);
  const call = fake.multicallCalls[0]!;
  assert.equal(call.multicallAddress.toLowerCase(), MULTICALL3_ADDRESS);
  assert.equal(call.allowFailure, true);
});

test("multicall calls never include `from` field (privacy invariant #1)", async () => {
  const { client, fake } = makeFakeClient();
  const proxy = createPooledRpcProxy(makeEnv(), { buildClient: () => client });
  await proxy.getBalances(base.id, HOLDER_A, SAMPLE_TOKENS);
  const call = fake.multicallCalls[0]!;
  for (const c of call.contracts) {
    assert.equal((c as { from?: string }).from, undefined, "contract entry must not include `from`");
  }
});

test("cross-user batching — 2 users in window → 1 multicall (privacy invariant #2)", async () => {
  const { client, fake } = makeFakeClient();
  const proxy = createPooledRpcProxy(makeEnv({ RPC_POOL_BATCH_WINDOW_MS: 50 }), {
    buildClient: () => client,
  });

  const [r1, r2] = await Promise.all([
    proxy.getBalances(base.id, HOLDER_A, SAMPLE_TOKENS),
    proxy.getBalances(base.id, HOLDER_B, SAMPLE_TOKENS),
  ]);

  assert.equal(fake.multicallCalls.length, 1, "expected exactly one multicall for 2 batched users");
  assert.equal(r1.length, 2);
  assert.equal(r2.length, 2);
});

test("cross-user batching dispatches each user's tokens correctly", async () => {
  const { client, fake } = makeFakeClient();
  // Each user has 2 tokens. Combined 4 contracts in order: A.USDC, A.WETH, B.USDC, B.WETH.
  fake.multicallResponses.push(() => [
    { status: "success", result: 1n },
    { status: "success", result: 2n },
    { status: "success", result: 3n },
    { status: "success", result: 4n },
  ]);

  const proxy = createPooledRpcProxy(makeEnv({ RPC_POOL_BATCH_WINDOW_MS: 50 }), {
    buildClient: () => client,
  });
  const [a, b] = await Promise.all([
    proxy.getBalances(base.id, HOLDER_A, SAMPLE_TOKENS),
    proxy.getBalances(base.id, HOLDER_B, SAMPLE_TOKENS),
  ]);
  assert.equal(a[0]!.balance, "1");
  assert.equal(a[1]!.balance, "2");
  assert.equal(b[0]!.balance, "3");
  assert.equal(b[1]!.balance, "4");
});

test("decoys — with ratio 0.5 and 2 tokens, expect ~1 decoy added", async () => {
  const { client, fake } = makeFakeClient();
  const proxy = createPooledRpcProxy(makeEnv({ RPC_POOL_DECOY_RATIO: 0.5 }), {
    buildClient: () => client,
  });
  fake.multicallResponses.push(() => [
    { status: "success", result: 1n },
    { status: "success", result: 2n },
    { status: "success", result: 0n }, // decoy
  ]);
  const r = await proxy.getBalances(base.id, HOLDER_A, SAMPLE_TOKENS);
  const call = fake.multicallCalls[0]!;
  assert.equal(call.contracts.length, 3, "expected 2 real + 1 decoy contracts");
  // Real results came back unmodified
  assert.equal(r.length, 2);
  assert.equal(r[0]!.balance, "1");
  assert.equal(r[1]!.balance, "2");
});

test("decoys — over many batches, decoy targets are drawn from the decoy pool", async () => {
  const { client, fake } = makeFakeClient();
  const proxy = createPooledRpcProxy(makeEnv({ RPC_POOL_DECOY_RATIO: 1.0 }), {
    buildClient: () => client,
  });
  // Run many sequential batches and inspect the decoy holders
  for (let i = 0; i < 20; i++) {
    await proxy.getBalances(base.id, HOLDER_A, SAMPLE_TOKENS);
  }
  const decoyPool = new Set(DECOY_ADDRESSES);
  let seenDecoys = 0;
  for (const call of fake.multicallCalls) {
    // Decoys are appended after real calls
    const decoyEntries = call.contracts.slice(SAMPLE_TOKENS.length);
    for (const e of decoyEntries) {
      const holder = e.args[0] as string;
      if (decoyPool.has(holder.toLowerCase())) seenDecoys++;
    }
  }
  assert.ok(seenDecoys >= 10, `expected ≥10 decoy calls drawn from pool, got ${seenDecoys}`);
});

test("getNativeBalance returns ETH balance", async () => {
  const { client, fake } = makeFakeClient();
  fake.getBalanceResponses.push(1_500_000_000_000_000_000n);
  const proxy = createPooledRpcProxy(makeEnv(), { buildClient: () => client });
  const r = await proxy.getNativeBalance(base.id, HOLDER_A);
  assert.equal(r.balance, "1500000000000000000");
  assert.equal(r.symbol, "ETH");
  assert.equal(r.decimals, 18);
  assert.equal(r.address, "native");
});

test("unsupported chain throws", async () => {
  const { client } = makeFakeClient();
  const proxy = createPooledRpcProxy(makeEnv(), { buildClient: () => client });
  await assert.rejects(
    () => proxy.getBalances(137, HOLDER_A, SAMPLE_TOKENS),
    /Unsupported chain/,
  );
});

test("invalid holder address throws", async () => {
  const { client } = makeFakeClient();
  const proxy = createPooledRpcProxy(makeEnv(), { buildClient: () => client });
  await assert.rejects(
    () => proxy.getBalances(base.id, "not-an-address", SAMPLE_TOKENS),
    /Invalid holder/,
  );
});

test("failed balanceOf in multicall returns '0' for that token", async () => {
  const { client, fake } = makeFakeClient();
  fake.multicallResponses.push(() => [
    { status: "failure" },
    { status: "success", result: 99n },
  ]);
  const proxy = createPooledRpcProxy(makeEnv(), { buildClient: () => client });
  const r = await proxy.getBalances(base.id, HOLDER_A, SAMPLE_TOKENS);
  assert.equal(r[0]!.balance, "0");
  assert.equal(r[1]!.balance, "99");
});

test("multicall RPC error — promise rejects + circuit breaker records error", async () => {
  const { client, fake } = makeFakeClient();
  fake.fail = true;
  const proxy = createPooledRpcProxy(makeEnv(), { buildClient: () => client });
  await assert.rejects(() => proxy.getBalances(base.id, HOLDER_A, SAMPLE_TOKENS), /multicall RPC error/);
  const h = await proxy.health();
  assert.equal(h.chains[base.id]!.errorCountInWindow, 1);
});

test("circuit breaker — N errors → switch to fallback when configured", async () => {
  const { client: primary, fake: primaryFake } = makeFakeClient();
  const { client: fallback } = makeFakeClient();
  primaryFake.fail = true;
  const env = makeEnv({
    BASE_RPC_URL_FALLBACK: "http://fake-base-fallback",
    RPC_POOL_FAILOVER_ERROR_THRESHOLD: 2,
  });
  let callCount = 0;
  const buildClient = () => {
    callCount++;
    return callCount === 1 ? primary : fallback;
  };
  const proxy = createPooledRpcProxy(env, { buildClient });
  // Trigger 2 errors
  await assert.rejects(() => proxy.getBalances(base.id, HOLDER_A, SAMPLE_TOKENS));
  await assert.rejects(() => proxy.getBalances(base.id, HOLDER_A, SAMPLE_TOKENS));
  const h = await proxy.health();
  assert.equal(h.chains[base.id]!.provider, "fallback");
});

test("circuit breaker — no fallback configured → provider goes 'down'", async () => {
  const { client, fake } = makeFakeClient();
  fake.fail = true;
  const env = makeEnv({ RPC_POOL_FAILOVER_ERROR_THRESHOLD: 2 });
  const proxy = createPooledRpcProxy(env, { buildClient: () => client });
  await assert.rejects(() => proxy.getBalances(base.id, HOLDER_A, SAMPLE_TOKENS));
  await assert.rejects(() => proxy.getBalances(base.id, HOLDER_A, SAMPLE_TOKENS));
  const h = await proxy.health();
  assert.equal(h.chains[base.id]!.provider, "down");
});

test("subsequent calls after 'down' state without fallback throw fast", async () => {
  const { client, fake } = makeFakeClient();
  fake.fail = true;
  const env = makeEnv({ RPC_POOL_FAILOVER_ERROR_THRESHOLD: 1 });
  const proxy = createPooledRpcProxy(env, { buildClient: () => client });
  await assert.rejects(() => proxy.getBalances(base.id, HOLDER_A, SAMPLE_TOKENS));
  // Now provider is 'down' — next call should be rejected immediately
  await assert.rejects(
    () => proxy.getBalances(base.id, HOLDER_A, SAMPLE_TOKENS),
    /RPC down/,
  );
});

test("default token list applied when caller omits tokens", async () => {
  const { client, fake } = makeFakeClient();
  const proxy = createPooledRpcProxy(makeEnv(), { buildClient: () => client });
  await proxy.getBalances(base.id, HOLDER_A); // no tokens param
  const call = fake.multicallCalls[0]!;
  // Default Base list has at least 10 tokens (per tokenLists test)
  assert.ok(call.contracts.length >= 10, `expected ≥10 default tokens, got ${call.contracts.length}`);
});

test("health reports both chains when both RPCs configured", async () => {
  const { client } = makeFakeClient();
  const proxy = createPooledRpcProxy(makeEnv(), { buildClient: () => client });
  const h = await proxy.health();
  assert.ok(h.chains[base.id]);
  assert.ok(h.chains[mainnet.id]);
  assert.equal(h.ok, true);
});

test("__internal hooks exposed for tests", async () => {
  const { client } = makeFakeClient();
  const proxy = createPooledRpcProxy(makeEnv(), { buildClient: () => client });
  assert.ok(proxy.__internal);
  assert.equal(proxy.__internal!.getQueueDepth(base.id), 0);
  assert.ok(proxy.__internal!.getDecoyPool().length >= 5);
});
