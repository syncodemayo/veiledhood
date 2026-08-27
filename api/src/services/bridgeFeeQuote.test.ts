import { test } from "node:test";
import assert from "node:assert/strict";
import { applyVeiledhoodBridgeFee } from "./bridgeFeeQuote.js";

test("applyVeiledhoodBridgeFee subtracts the bps fee from the receivable", () => {
  // 1,000,000 in, deBridge says 994,000 out, Veiledhood fee 25 bps on input = 2500
  const r = applyVeiledhoodBridgeFee({ amountIn: 1_000_000n, deBridgeOut: 994_000n, feeBps: 25 });
  assert.equal(r.veiledhoodFee, 2_500n);
  assert.equal(r.recipientReceives, 994_000n - 2_500n);
});

test("zero fee passes the deBridge amount through", () => {
  const r = applyVeiledhoodBridgeFee({ amountIn: 1_000_000n, deBridgeOut: 994_000n, feeBps: 0 });
  assert.equal(r.veiledhoodFee, 0n);
  assert.equal(r.recipientReceives, 994_000n);
});
