import assert from "node:assert/strict";
import test from "node:test";
import {
  computeTransferFeeBreakdown,
  computeTransferTotalFees,
} from "./transferFees.js";

test("no fees", () => {
  assert.equal(computeTransferTotalFees(1_000_000n, 0n, 0), 0n);
});

test("fixed only", () => {
  assert.equal(computeTransferTotalFees(1_000_000n, 500n, 0), 500n);
});

test("bps only (floor)", () => {
  // 1_000_000 * 30 / 10000 = 3000
  assert.equal(computeTransferTotalFees(1_000_000n, 0n, 30), 3000n);
  // 1 * 1 / 10000 = 0
  assert.equal(computeTransferTotalFees(1n, 0n, 1), 0n);
});

test("fixed + bps", () => {
  assert.equal(computeTransferTotalFees(10_000n, 100n, 50), 100n + 50n);
});

test("breakdown: fixed only", () => {
  const b = computeTransferFeeBreakdown(1_000_000n, 500n, 0);
  assert.equal(b.fixedFee, 500n);
  assert.equal(b.bpsFee, 0n);
  assert.equal(b.totalFees, 500n);
});

test("breakdown: bps only (floor)", () => {
  const b = computeTransferFeeBreakdown(1_000_000n, 0n, 30);
  assert.equal(b.fixedFee, 0n);
  assert.equal(b.bpsFee, 3000n);
  assert.equal(b.totalFees, 3000n);
  const tiny = computeTransferFeeBreakdown(1n, 0n, 1);
  assert.equal(tiny.bpsFee, 0n);
  assert.equal(tiny.totalFees, 0n);
});

test("breakdown: fixed + bps", () => {
  const b = computeTransferFeeBreakdown(10_000n, 100n, 50);
  assert.equal(b.fixedFee, 100n);
  assert.equal(b.bpsFee, 50n);
  assert.equal(b.totalFees, 150n);
});
