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
