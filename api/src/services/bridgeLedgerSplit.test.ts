import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { computeSplit, applyLedgerSplit } from "./bridgeLedgerSplit.js";
import { UserBalance } from "../models/UserBalance.js";

test("computeSplit conserves the total", () => {
  const { userRemaining, escrowAmount } = computeSplit(1000n, 300n);
  assert.equal(userRemaining, 700n);
  assert.equal(escrowAmount, 300n);
  assert.equal(userRemaining + escrowAmount, 1000n);
});

test("computeSplit allows bridging the full balance", () => {
  const { userRemaining, escrowAmount } = computeSplit(1000n, 1000n);
  assert.equal(userRemaining, 0n);
  assert.equal(escrowAmount, 1000n);
});

test("computeSplit rejects non-positive amount", () => {
  assert.throws(() => computeSplit(1000n, 0n), /amount must be positive/);
});

test("computeSplit rejects amount exceeding balance", () => {
  assert.throws(() => computeSplit(1000n, 1001n), /exceeds balance/);
});

// --- DB applier ---
let mem: MongoMemoryServer;
before(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri());
});
after(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await UserBalance.deleteMany({});
});

test("applyLedgerSplit debits user and credits escrow", async () => {
  const user = "0x1111111111111111111111111111111111111111";
  const escrow = "0x2222222222222222222222222222222222222222";
  await UserBalance.create({
    address: user,
    chainId: 8453,
    assetKey: "8453:usdc",
    currency: "usdc",
    totalAmount: "1000000",
  });

  await applyLedgerSplit({
    userAddress: user,
    escrowAddress: escrow,
    chainId: 8453,
    currency: "usdc",
    amount: 400000n,
  });

  const u = await UserBalance.findOne({ address: user, chainId: 8453 }).lean<{
    totalAmount?: string;
  } | null>();
  const e = await UserBalance.findOne({ address: escrow, chainId: 8453 }).lean<{
    totalAmount?: string;
  } | null>();
  assert.equal(u?.totalAmount, "600000");
  assert.equal(e?.totalAmount, "400000");
});

test("applyLedgerSplit throws when the user has insufficient balance", async () => {
  const user = "0x3333333333333333333333333333333333333333";
  await UserBalance.create({
    address: user,
    chainId: 8453,
    assetKey: "8453:usdc",
    currency: "usdc",
    totalAmount: "100",
  });
  await assert.rejects(
    () =>
      applyLedgerSplit({
        userAddress: user,
        escrowAddress: "0x4444444444444444444444444444444444444444",
        chainId: 8453,
        currency: "usdc",
        amount: 500n,
      }),
    /exceeds balance/
  );
});
