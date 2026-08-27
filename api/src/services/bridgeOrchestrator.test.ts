import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Bridge } from "../models/Bridge.js";
import { driveBridge, type BridgeExecutor } from "./bridgeOrchestrator.js";

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
});

function seed() {
  return Bridge.create({
    bridgeId: "brg_test_0001",
    userAddress: "0x1111111111111111111111111111111111111111",
    sourceChainId: 8453,
    destChainId: 1,
    currency: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    amountRequested: "1000000",
    escrowNonce: 1,
    status: "created",
  });
}

const happyExecutor: BridgeExecutor = {
  fundSourceGas: async () => "0x" + "a".repeat(64),
  sourceWithdraw: async () => ({ adminWithdrawTxHash: "0x" + "b".repeat(64) }),
  submitDeBridgeOrder: async () => ({ orderId: "0xorder", bridgeTxHash: "0x" + "c".repeat(64) }),
  waitForFulfillment: async () => ({ received: 994000n }),
  fundDestGas: async () => "0x" + "d".repeat(64),
  destDepositAndCredit: async () => ({ depositTxHash: "0x" + "e".repeat(64) }),
  refundToSource: async () => {},
};

test("happy path drives to complete and records amountReceived", async () => {
  await seed();
  await driveBridge("brg_test_0001", happyExecutor);
  const b = await Bridge.findOne({ bridgeId: "brg_test_0001" }).lean<{
    status?: string; amountReceived?: string; deBridgeOrderId?: string;
  } | null>();
  assert.equal(b?.status, "complete");
  assert.equal(b?.amountReceived, "994000");
  assert.equal(b?.deBridgeOrderId, "0xorder");
});

test("failure before fulfillment refunds and marks failed", async () => {
  await seed();
  let refunded = false;
  const failing: BridgeExecutor = {
    ...happyExecutor,
    submitDeBridgeOrder: async () => {
      throw new Error("deBridge down");
    },
    refundToSource: async () => {
      refunded = true;
    },
  };
  await driveBridge("brg_test_0001", failing);
  const b = await Bridge.findOne({ bridgeId: "brg_test_0001" }).lean<{
    status?: string; error?: string;
  } | null>();
  assert.equal(b?.status, "failed");
  assert.ok(refunded, "refund was invoked");
  assert.match(b?.error ?? "", /deBridge down/);
});

test("failure after fulfillment does NOT refund (funds recoverable; left for resume)", async () => {
  await seed();
  let refunded = false;
  const failing: BridgeExecutor = {
    ...happyExecutor,
    destDepositAndCredit: async () => {
      throw new Error("dest rpc hiccup");
    },
    refundToSource: async () => {
      refunded = true;
    },
  };
  await assert.rejects(() => driveBridge("brg_test_0001", failing), /dest rpc hiccup/);
  const b = await Bridge.findOne({ bridgeId: "brg_test_0001" }).lean<{ status?: string } | null>();
  assert.equal(b?.status, "dest_deposited"); // stuck here for resume, not refunded
  assert.equal(refunded, false);
});

test("driving an already-complete bridge is a no-op", async () => {
  const b = await seed();
  await Bridge.updateOne({ bridgeId: b.bridgeId }, { $set: { status: "complete" } });
  await driveBridge("brg_test_0001", {
    ...happyExecutor,
    fundSourceGas: async () => {
      throw new Error("should not be called");
    },
  });
  const after = await Bridge.findOne({ bridgeId: "brg_test_0001" }).lean<{ status?: string } | null>();
  assert.equal(after?.status, "complete");
});
