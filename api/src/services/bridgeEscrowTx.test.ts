import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGasTopUp } from "./bridgeEscrowTx.js";

test("computeGasTopUp = gasLimit * gasPrice * buffer", () => {
  // 300000 gas * 2 gwei * 1.5 buffer = 900000 * 1e9 = 9e14 wei
  const topUp = computeGasTopUp({
    gasLimit: 300_000n,
    gasPriceWei: 2_000_000_000n,
    bufferPct: 50,
  });
  assert.equal(topUp, 900_000n * 1_000_000_000n);
});

test("computeGasTopUp never returns below the floor", () => {
  const topUp = computeGasTopUp({
    gasLimit: 1n,
    gasPriceWei: 1n,
    bufferPct: 0,
    floorWei: 100_000_000_000_000n, // 0.0001 ETH
  });
  assert.equal(topUp, 100_000_000_000_000n);
});

test("computeGasTopUp rejects non-positive inputs", () => {
  assert.throws(() => computeGasTopUp({ gasLimit: 0n, gasPriceWei: 1n, bufferPct: 0 }), /gasLimit/);
});
