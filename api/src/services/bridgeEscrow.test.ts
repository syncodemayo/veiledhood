import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  deriveEscrowWallet,
  sourceEscrowIndex,
  destEscrowIndex,
} from "./bridgeEscrow.js";

const SEED = "test test test test test test test test test test test junk";

test("derivation is deterministic for the same seed + index", () => {
  const a = deriveEscrowWallet(SEED, 0);
  const b = deriveEscrowWallet(SEED, 0);
  assert.equal(a.address, b.address);
  assert.ok(ethers.isAddress(a.address));
});

test("different indices yield different addresses", () => {
  const a = deriveEscrowWallet(SEED, 0);
  const b = deriveEscrowWallet(SEED, 1);
  assert.notEqual(a.address, b.address);
});

test("source and dest legs of the same bridge get distinct indices", () => {
  const n = 4;
  assert.notEqual(sourceEscrowIndex(n), destEscrowIndex(n));
  // Distinct across bridges too.
  assert.notEqual(sourceEscrowIndex(4), sourceEscrowIndex(5));
});

test("source/dest derive to distinct addresses for one bridge", () => {
  const n = 9;
  const src = deriveEscrowWallet(SEED, sourceEscrowIndex(n));
  const dst = deriveEscrowWallet(SEED, destEscrowIndex(n));
  assert.notEqual(src.address, dst.address);
});

test("throws on empty seed", () => {
  assert.throws(() => deriveEscrowWallet("", 0), /BRIDGE_ESCROW_SEED/);
});
