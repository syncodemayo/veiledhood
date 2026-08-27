# Private Bridging — Plan 2: deBridge DLN Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A thin, fully-tested REST client for the deBridge DLN API — `quote`, `createOrderTx`, `getOrderStatus`, `getOrderIdsByTxHash` — with an injectable `fetch` for deterministic unit tests and one guarded live quote-only smoke. No money movement; no chain writes.

**Architecture:** Single service `deBridgeClient.ts` + one env var (`DEBRIDGE_STATS_API_URL`). Two hosts per the spec spike: create-tx on `DEBRIDGE_API_URL`, status/lookups on `DEBRIDGE_STATS_API_URL`. `fetch` is injected so unit tests never hit the network; a separate smoke test (opt-in via env flag) validates the real response shape.

**Tech Stack:** TypeScript ESM, native `fetch`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-18-private-base-eth-bridging-design.md` (see "deBridge DLN spike findings").

---

## Task 1: Add `DEBRIDGE_STATS_API_URL` env var

**Files:** Modify `api/src/config/env.ts`, `api/.env.example`; the existing `api/src/config/env.bridge.test.ts` gets one new assertion.

- [ ] **Step 1: Add the field to `BRIDGE_ENV_SHAPE`** (after `DEBRIDGE_API_URL`):

```typescript
  /** deBridge order-status/tracking API base (different host from create-tx). */
  DEBRIDGE_STATS_API_URL: z
    .string()
    .url()
    .default("https://dln-api.debridge.finance/api"),
```

- [ ] **Step 2: Add a default-value assertion** to the "applies safe defaults" test in `env.bridge.test.ts`:

```typescript
  assert.equal(parsed.DEBRIDGE_STATS_API_URL, "https://dln-api.debridge.finance/api");
```

- [ ] **Step 3: Append to `.env.example`** under the bridging block:

```
DEBRIDGE_STATS_API_URL=https://dln-api.debridge.finance/api
```

- [ ] **Step 4: Run + build**

Run: `cd api && npx tsx --test src/config/env.bridge.test.ts && npm run build`
Expected: env tests pass; `tsc` exits 0.

- [ ] **Step 5: Commit**

```bash
git add api/src/config/env.ts api/src/config/env.bridge.test.ts api/.env.example
git commit -m "feat(bridge): add DEBRIDGE_STATS_API_URL env var"
```

---

## Task 2: deBridge DLN client

**Files:** Create `api/src/services/deBridgeClient.ts`, `api/src/services/deBridgeClient.test.ts`.

- [ ] **Step 1: Write the failing test** (mocked `fetch`):

```typescript
// api/src/services/deBridgeClient.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeBridgeClient, DEBRIDGE_NATIVE } from "./deBridgeClient.js";

type Captured = { url: string };

function mockFetch(captured: Captured[], body: unknown, ok = true, status = 200) {
  return async (url: string | URL): Promise<Response> => {
    captured.push({ url: url.toString() });
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  };
}

const CREATE_TX_BODY = {
  orderId: "0xabc",
  estimation: {
    srcChainTokenIn: { amount: "1000000" },
    dstChainTokenOut: { amount: "994000", recommendedAmount: "994000" },
    costsDetails: [],
  },
  tx: { to: "0xDLN", data: "0xdeadbeef", value: "1000" },
};

test("quote builds the create-tx URL without recipient/authority and parses amounts", async () => {
  const captured: Captured[] = [];
  const client = createDeBridgeClient({
    apiUrl: "https://dln.debridge.finance/v1.0",
    statsApiUrl: "https://dln-api.debridge.finance/api",
    fetchImpl: mockFetch(captured, CREATE_TX_BODY),
  });
  const q = await client.quote({
    srcChainId: 8453,
    srcTokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    srcAmountIn: "1000000",
    dstChainId: 1,
    dstTokenOut: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  });
  assert.equal(q.srcAmountIn, "1000000");
  assert.equal(q.dstAmountOut, "994000");
  const url = captured[0].url;
  assert.ok(url.startsWith("https://dln.debridge.finance/v1.0/dln/order/create-tx?"));
  assert.ok(url.includes("srcChainId=8453"));
  assert.ok(url.includes("dstChainTokenOutAmount=auto"));
  // Quote mode: no recipient/authority params.
  assert.ok(!url.includes("dstChainTokenOutRecipient="));
});

test("createOrderTx includes recipient + authorities + sender and returns the tx", async () => {
  const captured: Captured[] = [];
  const client = createDeBridgeClient({
    apiUrl: "https://dln.debridge.finance/v1.0",
    statsApiUrl: "https://dln-api.debridge.finance/api",
    fetchImpl: mockFetch(captured, CREATE_TX_BODY),
  });
  const r = await client.createOrderTx({
    srcChainId: 8453,
    srcTokenIn: DEBRIDGE_NATIVE,
    srcAmountIn: "5000000000000000",
    dstChainId: 1,
    dstTokenOut: DEBRIDGE_NATIVE,
    dstRecipient: "0x1111111111111111111111111111111111111111",
    srcOrderAuthority: "0x2222222222222222222222222222222222222222",
    dstOrderAuthority: "0x1111111111111111111111111111111111111111",
    senderAddress: "0x2222222222222222222222222222222222222222",
  });
  assert.equal(r.orderId, "0xabc");
  assert.equal(r.tx.to, "0xDLN");
  assert.equal(r.tx.data, "0xdeadbeef");
  assert.equal(r.tx.value, "1000");
  assert.equal(r.dstAmountOut, "994000");
  const url = captured[0].url;
  assert.ok(url.includes("dstChainTokenOutRecipient=0x1111111111111111111111111111111111111111"));
  assert.ok(url.includes("srcChainOrderAuthorityAddress=0x2222222222222222222222222222222222222222"));
  assert.ok(url.includes("dstChainOrderAuthorityAddress=0x1111111111111111111111111111111111111111"));
});

test("getOrderStatus hits the stats host and returns the state string", async () => {
  const captured: Captured[] = [];
  const client = createDeBridgeClient({
    apiUrl: "https://dln.debridge.finance/v1.0",
    statsApiUrl: "https://dln-api.debridge.finance/api",
    fetchImpl: mockFetch(captured, { orderId: { stringValue: "0xabc" }, state: "Fulfilled" }),
  });
  const s = await client.getOrderStatus("0xabc");
  assert.equal(s, "Fulfilled");
  assert.equal(captured[0].url, "https://dln-api.debridge.finance/api/Orders/0xabc");
});

test("getOrderIdsByTxHash returns the orderIds array", async () => {
  const captured: Captured[] = [];
  const client = createDeBridgeClient({
    apiUrl: "https://dln.debridge.finance/v1.0",
    statsApiUrl: "https://dln-api.debridge.finance/api",
    fetchImpl: mockFetch(captured, { orderIds: ["0xabc", "0xdef"] }),
  });
  const ids = await client.getOrderIdsByTxHash("0xhash");
  assert.deepEqual(ids, ["0xabc", "0xdef"]);
  assert.equal(captured[0].url, "https://dln-api.debridge.finance/api/Transaction/0xhash/orderIds");
});

test("a non-200 response throws a DeBridgeApiError with status", async () => {
  const client = createDeBridgeClient({
    apiUrl: "https://dln.debridge.finance/v1.0",
    statsApiUrl: "https://dln-api.debridge.finance/api",
    fetchImpl: mockFetch([], { errorMessage: "bad" }, false, 400),
  });
  await assert.rejects(
    () =>
      client.quote({
        srcChainId: 8453,
        srcTokenIn: DEBRIDGE_NATIVE,
        srcAmountIn: "1",
        dstChainId: 1,
        dstTokenOut: DEBRIDGE_NATIVE,
      }),
    /deBridge API 400/
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx tsx --test src/services/deBridgeClient.test.ts`
Expected: FAIL — `Cannot find module './deBridgeClient.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// api/src/services/deBridgeClient.ts

/** Native asset (ETH) on EVM chains per deBridge DLN. */
export const DEBRIDGE_NATIVE = "0x0000000000000000000000000000000000000000";

export type FetchImpl = (url: string | URL, init?: RequestInit) => Promise<Response>;

export class DeBridgeApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`deBridge API ${status}: ${body.slice(0, 300)}`);
    this.name = "DeBridgeApiError";
  }
}

export interface DeBridgeClientConfig {
  apiUrl: string; // create-tx host, e.g. https://dln.debridge.finance/v1.0
  statsApiUrl: string; // status host, e.g. https://dln-api.debridge.finance/api
  referralCode?: string;
  affiliateFeePercent?: number;
  fetchImpl?: FetchImpl;
}

export interface DlnQuoteParams {
  srcChainId: number;
  srcTokenIn: string;
  srcAmountIn: string;
  dstChainId: number;
  dstTokenOut: string;
}

export interface DlnQuote {
  orderId?: string;
  srcAmountIn: string;
  dstAmountOut: string;
}

export interface DlnCreateParams extends DlnQuoteParams {
  dstRecipient: string;
  srcOrderAuthority: string;
  dstOrderAuthority: string;
  senderAddress: string;
}

export interface DlnOrderTx {
  orderId: string;
  dstAmountOut: string;
  tx: { to: string; data: string; value: string };
}

interface CreateTxResponse {
  orderId?: string;
  estimation?: {
    srcChainTokenIn?: { amount?: string };
    dstChainTokenOut?: { amount?: string; recommendedAmount?: string };
  };
  tx?: { to?: string; data?: string; value?: string };
}

export interface DeBridgeClient {
  quote(p: DlnQuoteParams): Promise<DlnQuote>;
  createOrderTx(p: DlnCreateParams): Promise<DlnOrderTx>;
  getOrderStatus(orderId: string): Promise<string>;
  getOrderIdsByTxHash(hash: string): Promise<string[]>;
}

export function createDeBridgeClient(cfg: DeBridgeClientConfig): DeBridgeClient {
  const doFetch: FetchImpl = cfg.fetchImpl ?? ((u, i) => fetch(u, i));
  const apiUrl = cfg.apiUrl.replace(/\/$/, "");
  const statsApiUrl = cfg.statsApiUrl.replace(/\/$/, "");

  async function getJson<T>(url: string): Promise<T> {
    const res = await doFetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new DeBridgeApiError(res.status, body);
    }
    return (await res.json()) as T;
  }

  function createTxUrl(p: DlnQuoteParams, extra: Record<string, string>): string {
    const qs = new URLSearchParams({
      srcChainId: String(p.srcChainId),
      srcChainTokenIn: p.srcTokenIn,
      srcChainTokenInAmount: p.srcAmountIn,
      dstChainId: String(p.dstChainId),
      dstChainTokenOut: p.dstTokenOut,
      dstChainTokenOutAmount: "auto",
      ...(cfg.referralCode ? { referralCode: cfg.referralCode } : {}),
      ...(cfg.affiliateFeePercent != null
        ? { affiliateFeePercent: String(cfg.affiliateFeePercent) }
        : {}),
      ...extra,
    });
    return `${apiUrl}/dln/order/create-tx?${qs.toString()}`;
  }

  function dstAmount(body: CreateTxResponse): string {
    const d = body.estimation?.dstChainTokenOut;
    return d?.recommendedAmount ?? d?.amount ?? "0";
  }

  return {
    async quote(p) {
      const body = await getJson<CreateTxResponse>(createTxUrl(p, {}));
      return {
        orderId: body.orderId,
        srcAmountIn: body.estimation?.srcChainTokenIn?.amount ?? p.srcAmountIn,
        dstAmountOut: dstAmount(body),
      };
    },

    async createOrderTx(p) {
      const url = createTxUrl(p, {
        dstChainTokenOutRecipient: p.dstRecipient,
        srcChainOrderAuthorityAddress: p.srcOrderAuthority,
        dstChainOrderAuthorityAddress: p.dstOrderAuthority,
        senderAddress: p.senderAddress,
      });
      const body = await getJson<CreateTxResponse>(url);
      if (!body.orderId || !body.tx?.to || !body.tx?.data) {
        throw new Error("deBridge create-tx response missing orderId/tx");
      }
      return {
        orderId: body.orderId,
        dstAmountOut: dstAmount(body),
        tx: {
          to: body.tx.to,
          data: body.tx.data,
          value: body.tx.value ?? "0",
        },
      };
    },

    async getOrderStatus(orderId) {
      const body = await getJson<{ state?: string; status?: string }>(
        `${statsApiUrl}/Orders/${orderId}`
      );
      const state = body.state ?? body.status;
      if (!state) throw new Error("deBridge status response missing state");
      return state;
    },

    async getOrderIdsByTxHash(hash) {
      const body = await getJson<{ orderIds?: string[] }>(
        `${statsApiUrl}/Transaction/${hash}/orderIds`
      );
      return body.orderIds ?? [];
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd api && npx tsx --test src/services/deBridgeClient.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Build**

Run: `cd api && npm run build`
Expected: `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/services/deBridgeClient.ts api/src/services/deBridgeClient.test.ts
git commit -m "feat(bridge): deBridge DLN REST client (quote/create/status/lookup)"
```

---

## Task 3: Guarded live quote-only smoke

Validates that the real API response shape matches the parser, using a tiny **quote-only** request (no recipient, no authority, no on-chain submit, no funds). Skipped by default so CI never depends on the network.

**Files:** Create `api/src/services/deBridgeClient.smoke.test.ts`.

- [ ] **Step 1: Write the smoke test**

```typescript
// api/src/services/deBridgeClient.smoke.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeBridgeClient } from "./deBridgeClient.js";

// Opt-in only: DEBRIDGE_LIVE_SMOKE=1 npx tsx --test src/services/deBridgeClient.smoke.test.ts
const LIVE = process.env.DEBRIDGE_LIVE_SMOKE === "1";

test(
  "live: quote 1 USDC Base->Eth returns a positive dst amount",
  { skip: !LIVE },
  async () => {
    const client = createDeBridgeClient({
      apiUrl: "https://dln.debridge.finance/v1.0",
      statsApiUrl: "https://dln-api.debridge.finance/api",
    });
    const q = await client.quote({
      srcChainId: 8453,
      srcTokenIn: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC Base
      srcAmountIn: "1000000", // 1 USDC
      dstChainId: 1,
      dstTokenOut: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC Eth
    });
    assert.ok(BigInt(q.dstAmountOut) > 0n, `dstAmountOut was ${q.dstAmountOut}`);
  }
);

test(
  "live: quote native ETH Base->Eth (confirms 0x0 native handling)",
  { skip: !LIVE },
  async () => {
    const client = createDeBridgeClient({
      apiUrl: "https://dln.debridge.finance/v1.0",
      statsApiUrl: "https://dln-api.debridge.finance/api",
    });
    const q = await client.quote({
      srcChainId: 8453,
      srcTokenIn: "0x0000000000000000000000000000000000000000",
      srcAmountIn: "10000000000000000", // 0.01 ETH
      dstChainId: 1,
      dstTokenOut: "0x0000000000000000000000000000000000000000",
    });
    assert.ok(BigInt(q.dstAmountOut) > 0n, `dstAmountOut was ${q.dstAmountOut}`);
  }
);
```

- [ ] **Step 2: Run it skipped (default, offline-safe)**

Run: `cd api && npx tsx --test src/services/deBridgeClient.smoke.test.ts`
Expected: both tests reported `skipped`.

- [ ] **Step 3: Run it live once to confirm the real response shape**

Run: `cd api && DEBRIDGE_LIVE_SMOKE=1 npx tsx --test src/services/deBridgeClient.smoke.test.ts`
Expected: both PASS. If a field name differs from the parser (e.g. `state` vs `status`, `recommendedAmount` absent), fix `deBridgeClient.ts` to match the real shape and re-run. Record the confirmed ETH-native behavior in the spec's "Open items still to resolve".

- [ ] **Step 4: Commit**

```bash
git add api/src/services/deBridgeClient.smoke.test.ts
git commit -m "test(bridge): guarded live quote-only smoke for deBridge client"
```

---

## Self-Review

**Spec coverage:** deBridge client `quote`/`createOrderTx`/`getOrderStatus`/`getOrderIdsByTxHash` ✓; two-host split ✓; native ETH = `0x0` ✓; `DEBRIDGE_STATS_API_URL` env ✓; testnet-avoidance via mocked tests + quote-only live smoke ✓.
**Placeholder scan:** none — runnable code + commands throughout.
**Type consistency:** `DlnQuoteParams`/`DlnCreateParams`/`DlnOrderTx`/`DeBridgeClient`/`DEBRIDGE_NATIVE`/`DeBridgeApiError` consistent across test and impl.
**Note for Plan 3:** the orchestrator builds the client from env (`createDeBridgeClient({ apiUrl: env.DEBRIDGE_API_URL, statsApiUrl: env.DEBRIDGE_STATS_API_URL, referralCode: env.DEBRIDGE_REFERRAL_CODE })`), submits `tx` on-chain from the source escrow wallet within ~30s, and polls `getOrderStatus` until `Fulfilled` before the destination deposit + credit.
