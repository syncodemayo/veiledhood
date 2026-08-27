import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Bridge, BRIDGE_STATUSES } from "./Bridge.js";

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

function validDoc() {
  return {
    bridgeId: "brg_01HZ000000000000000000000",
    userAddress: "0x1111111111111111111111111111111111111111",
    sourceChainId: 8453,
    destChainId: 1,
    currency: "USDC",
    amountRequested: "1000000",
    status: "created" as const,
  };
}

test("persists a valid bridge with defaults", async () => {
  const doc = await Bridge.create(validDoc());
  assert.equal(doc.status, "created");
  assert.equal(doc.amountReceived, undefined);
  assert.ok(doc.createdAt instanceof Date);
});

test("enforces unique bridgeId", async () => {
  await Bridge.create(validDoc());
  await assert.rejects(() => Bridge.create(validDoc()), /duplicate key/i);
});

test("rejects an out-of-enum status", async () => {
  await assert.rejects(
    () => Bridge.create({ ...validDoc(), status: "teleported" as never }),
    /not a valid enum/i
  );
});

test("status enum constant matches the schema", () => {
  assert.ok(BRIDGE_STATUSES.includes("complete"));
  assert.ok(BRIDGE_STATUSES.includes("refunded"));
  assert.equal(BRIDGE_STATUSES[0], "created");
});
