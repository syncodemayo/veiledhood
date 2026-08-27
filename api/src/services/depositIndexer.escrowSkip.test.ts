import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Bridge } from "../models/Bridge.js";
import { UserBalance } from "../models/UserBalance.js";
import { applyDepositedLog, isBridgeEscrowAddress } from "./depositIndexer.js";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ESCROW = "0x1111111111111111111111111111111111111111";
const USER = "0x2222222222222222222222222222222222222222";

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
  await Bridge.deleteMany({});
  await UserBalance.deleteMany({});
});

test("indexer skips a bridge escrow's deposit (prevents Eth->Base double-credit)", async () => {
  await Bridge.create({
    bridgeId: "brg_test",
    userAddress: USER,
    sourceChainId: 1,
    destChainId: 8453,
    currency: USDC,
    amountRequested: "4000000",
    escrowNonce: 1,
    status: "dest_deposited",
    destEscrowAddress: ESCROW,
  });

  assert.equal(await isBridgeEscrowAddress(ESCROW), true);

  await applyDepositedLog(ESCROW, USDC, 4_000_000n, 8453, "0x" + "a".repeat(64));
  const bal = await UserBalance.findOne({ address: ESCROW.toLowerCase(), chainId: 8453 }).lean();
  assert.equal(bal, null, "escrow address must NOT be credited by the indexer");
});

test("indexer still credits a normal user's deposit", async () => {
  assert.equal(await isBridgeEscrowAddress(USER), false);

  await applyDepositedLog(USER, USDC, 4_000_000n, 8453, "0x" + "b".repeat(64));
  const bal = await UserBalance.findOne({ address: USER.toLowerCase(), chainId: 8453 }).lean<{
    totalAmount?: string;
  } | null>();
  assert.ok(bal, "normal user should be credited");
  assert.equal(bal?.totalAmount, "4000000");
});
