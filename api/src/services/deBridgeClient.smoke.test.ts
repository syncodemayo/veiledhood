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
