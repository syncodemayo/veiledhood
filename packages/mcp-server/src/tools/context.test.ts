import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { handleContextShielded, contextShieldedInputShape } from "./contextShielded.js";
import { handleContextPublic, contextPublicInputShape } from "./contextPublic.js";
import { handleContextFull, contextFullInputShape } from "./contextFull.js";
import {
  setupTestEnv,
  cleanupTestEnv,
  stubFetch,
  makeResponse,
  TEST_ADDR,
  type TestEnv,
  type FetchStub,
} from "../test/setup.js";

let env: TestEnv;
let fetchStub: FetchStub | undefined;

beforeEach(async () => {
  env = await setupTestEnv();
});
afterEach(async () => {
  fetchStub?.restore();
  fetchStub = undefined;
  await cleanupTestEnv(env);
});

// ---------- input shapes (ZodRawShape guard) ----------

test("input shapes are ZodRawShape (plain objects of zod fields)", () => {
  // Plain object, NOT z.object({...}) — see schema-shape.test.ts for why
  assert.equal(typeof contextShieldedInputShape, "object");
  assert.equal(Object.keys(contextShieldedInputShape).length, 1);
  assert.equal(typeof contextPublicInputShape, "object");
  assert.equal(typeof contextFullInputShape, "object");
});

// ---------- context_shielded ----------

test("context_shielded — formats balances with USD totals", async () => {
  fetchStub = stubFetch(() =>
    makeResponse(200, {
      address: TEST_ADDR,
      chainId: 8453,
      balances: [
        { currency: "usdc", amount: "4200000000", decimals: 6, symbol: "USDC", usdValue: 4200 },
      ],
      totalUsd: 4200,
      at: 1_700_000_000_000,
    }),
  );
  const res = await handleContextShielded({});
  assert.equal(res.isError, undefined);
  const text = res.content[0]!.text;
  assert.ok(text.includes(`Shielded balances for ${TEST_ADDR}`));
  assert.ok(text.includes("$4,200"));
  assert.ok(text.includes("USDC"));
});

test("context_shielded — empty balances render a friendly hint", async () => {
  fetchStub = stubFetch(() =>
    makeResponse(200, {
      address: TEST_ADDR,
      chainId: 8453,
      balances: [],
      totalUsd: null,
      at: 1_700_000_000_000,
    }),
  );
  const res = await handleContextShielded({ chainId: 8453 });
  assert.ok(res.content[0]!.text.includes("(no shielded balances)"));
});

test("context_shielded — POST body carries chainId", async () => {
  fetchStub = stubFetch(() =>
    makeResponse(200, {
      address: TEST_ADDR,
      chainId: 1,
      balances: [],
      totalUsd: null,
      at: 1_700_000_000_000,
    }),
  );
  await handleContextShielded({ chainId: 1 });
  assert.equal(fetchStub!.calls.length, 1);
  const call = fetchStub!.calls[0]!;
  assert.equal(call.init?.method, "POST");
  assert.match(call.url, /\/context\/shielded$/);
  const body = JSON.parse(call.init!.body as string);
  assert.equal(body.chainId, 1);
});

// ---------- context_public ----------

test("context_public — formats native + ERC-20 with USD", async () => {
  fetchStub = stubFetch(() =>
    makeResponse(200, {
      address: TEST_ADDR,
      chainId: 8453,
      native: { symbol: "ETH", balance: "2000000000000000000", priceUsd: 3500, usdValue: 7000 },
      tokens: [
        {
          address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          symbol: "USDC",
          decimals: 6,
          balance: "500000000",
          priceUsd: 1,
          usdValue: 500,
        },
        {
          address: "0x4200000000000000000000000000000000000006",
          symbol: "WETH",
          decimals: 18,
          balance: "0",
          priceUsd: 3500,
          usdValue: 0,
        },
      ],
      totalUsd: 7500,
      at: 1_700_000_000_000,
    }),
  );
  const res = await handleContextPublic({});
  const text = res.content[0]!.text;
  assert.ok(text.includes("ETH"));
  assert.ok(text.includes("USDC"));
  assert.ok(text.includes("$7,500"));
  // Zero-balance tokens should be omitted from public view
  assert.doesNotMatch(text, /WETH\s+0\s/);
});

test("context_public — surfaces backend 503 as a tool error", async () => {
  fetchStub = stubFetch(() => makeResponse(503, { error: "down" }));
  const res = await handleContextPublic({});
  assert.equal(res.isError, true);
});

// ---------- context_full ----------

test("context_full — combines shielded + public + privacy block", async () => {
  fetchStub = stubFetch(() =>
    makeResponse(200, {
      address: TEST_ADDR,
      chainId: 8453,
      shielded: {
        balances: [
          { currency: "usdc", amount: "1000000000", decimals: 6, symbol: "USDC", usdValue: 1000 },
        ],
        totalUsd: 1000,
      },
      public: {
        native: { symbol: "ETH", balance: "1000000000000000000", priceUsd: 3500, usdValue: 3500 },
        tokens: [],
        totalUsd: 3500,
      },
      totalUsd: 4500,
      at: 1_700_000_000_000,
      privacy: { decoyRatio: 0.1, batchWindowMs: 100 },
    }),
  );
  const res = await handleContextFull({});
  const text = res.content[0]!.text;
  assert.ok(text.includes(`Wallet context for ${TEST_ADDR}`));
  assert.ok(text.includes("$4,500")); // total
  assert.ok(text.includes("Shielded"));
  assert.ok(text.includes("Public"));
  assert.ok(text.includes("USDC"));
  assert.ok(text.includes("ETH"));
});

test("context_full — null totalUsd renders as '—' (not '$null')", async () => {
  fetchStub = stubFetch(() =>
    makeResponse(200, {
      address: TEST_ADDR,
      chainId: 8453,
      shielded: { balances: [], totalUsd: null },
      public: {
        native: { symbol: "ETH", balance: "0", priceUsd: null, usdValue: null },
        tokens: [],
        totalUsd: null,
      },
      totalUsd: null,
      at: 1_700_000_000_000,
      privacy: { decoyRatio: 0, batchWindowMs: 100 },
    }),
  );
  const res = await handleContextFull({});
  const text = res.content[0]!.text;
  assert.ok(text.includes("Total: —"));
  assert.doesNotMatch(text, /null/);
});

test("context_full — rate-limit 429 surfaces as tool error with code", async () => {
  fetchStub = stubFetch(() => makeResponse(429, { error: "rate" }, { "retry-after": "30" }));
  const res = await handleContextFull({});
  assert.equal(res.isError, true);
  assert.ok(res.content[0]!.text.includes("VEILEDHOOD_API_RATE_LIMIT"));
});

test("context_full — POST body carries optional chainId", async () => {
  fetchStub = stubFetch(() =>
    makeResponse(200, {
      address: TEST_ADDR,
      chainId: 1,
      shielded: { balances: [], totalUsd: null },
      public: {
        native: { symbol: "ETH", balance: "0", priceUsd: null, usdValue: null },
        tokens: [],
        totalUsd: null,
      },
      totalUsd: null,
      at: 1_700_000_000_000,
      privacy: { decoyRatio: 0, batchWindowMs: 100 },
    }),
  );
  await handleContextFull({ chainId: 1 });
  const body = JSON.parse(fetchStub!.calls[0]!.init!.body as string);
  assert.equal(body.chainId, 1);
});

test("context_full — VEILEDHOOD_REAUTH_REQUIRED on 401 with helpful re-onboard URL", async () => {
  fetchStub = stubFetch(() => makeResponse(401, { error: "expired" }));
  const res = await handleContextFull({});
  assert.equal(res.isError, true);
  assert.ok(res.content[0]!.text.includes("VEILEDHOOD_REAUTH_REQUIRED"));
});
