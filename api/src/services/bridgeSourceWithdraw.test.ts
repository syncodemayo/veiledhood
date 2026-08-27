import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { UserBalance } from "../models/UserBalance.js";
import { buildAssetKey } from "../util/chainLedger.js";
import { withdrawEscrowLeaf, type SourceChainOps } from "./bridgeSourceWithdraw.js";

// Ledger `currency` is the token address (lowercased), per ledgerCurrencyToMerkleToken.
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

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

const fakeChain: SourceChainOps = {
  commitRoot: async () => ({ root: "0x" + "1".repeat(64), txHash: "0x" + "a".repeat(64), skipped: false }),
  proofForEscrow: async () => ["0x" + "b".repeat(64)],
  readRoot: async () => "0x" + "1".repeat(64),
  signAuth: async () => ({ signature: "0xsig", deadline: 1n }),
  adminWithdraw: async () => ({ txHash: "0x" + "c".repeat(64) }),
};

test("splits the user leaf, leaves escrow leaf zeroed after withdraw", async () => {
  const user = "0x1111111111111111111111111111111111111111";
  const escrow = "0x2222222222222222222222222222222222222222";
  await UserBalance.create({
    address: user, chainId: 8453, assetKey: buildAssetKey(8453, USDC_BASE), currency: USDC_BASE, totalAmount: "1000000",
  });

  const res = await withdrawEscrowLeaf({
    chainId: 8453,
    currency: USDC_BASE,
    userAddress: user,
    escrowAddress: escrow,
    amount: 400000n,
    chain: fakeChain,
  });

  const u = await UserBalance.findOne({ address: user, chainId: 8453 }).lean<{ totalAmount?: string } | null>();
  const e = await UserBalance.findOne({ address: escrow, chainId: 8453 }).lean<{ totalAmount?: string } | null>();
  assert.equal(u?.totalAmount, "600000"); // user debited
  assert.equal(e?.totalAmount, "0"); // escrow leaf zeroed after payout
  assert.equal(res.adminWithdrawTxHash, "0x" + "c".repeat(64));
});
