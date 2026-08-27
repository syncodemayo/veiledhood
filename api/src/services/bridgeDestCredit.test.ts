import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { UserBalance } from "../models/UserBalance.js";
import { buildAssetKey } from "../util/chainLedger.js";
import { creditDestShielded, type DestChainOps } from "./bridgeDestCredit.js";

// Ledger `currency` is the token address (lowercased), per ledgerCurrencyToMerkleToken.
const USDC_ETH = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

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

const fakeChain: DestChainOps = {
  deposit: async () => ({ txHash: "0x" + "d".repeat(64) }),
  commitRoot: async () => ({ root: "0x" + "1".repeat(64), txHash: "0x" + "e".repeat(64), skipped: false }),
};

test("credits the destination shielded leaf with the received amount", async () => {
  const shielded = "0x5555555555555555555555555555555555555555";
  const res = await creditDestShielded({
    chainId: 1,
    currency: USDC_ETH,
    shieldedAddress: shielded,
    amountReceived: 994000n,
    chain: fakeChain,
  });
  const row = await UserBalance.findOne({ address: shielded, chainId: 1 }).lean<{ totalAmount?: string } | null>();
  assert.equal(row?.totalAmount, "994000");
  assert.equal(res.depositTxHash, "0x" + "d".repeat(64));
});

test("adds to an existing shielded balance (does not overwrite)", async () => {
  const shielded = "0x5555555555555555555555555555555555555555";
  await UserBalance.create({
    address: shielded, chainId: 1, assetKey: buildAssetKey(1, USDC_ETH), currency: USDC_ETH, totalAmount: "1000",
  });
  await creditDestShielded({
    chainId: 1, currency: USDC_ETH, shieldedAddress: shielded, amountReceived: 994000n, chain: fakeChain,
  });
  const row = await UserBalance.findOne({ address: shielded, chainId: 1 }).lean<{ totalAmount?: string } | null>();
  assert.equal(row?.totalAmount, "995000");
});
