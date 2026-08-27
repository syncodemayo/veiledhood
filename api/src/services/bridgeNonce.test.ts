import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { nextEscrowNonce } from "./bridgeNonce.js";

let mem: MongoMemoryServer;
before(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri());
});
after(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

test("nextEscrowNonce returns strictly increasing values", async () => {
  const a = await nextEscrowNonce();
  const b = await nextEscrowNonce();
  const c = await nextEscrowNonce();
  assert.ok(b > a, `${b} > ${a}`);
  assert.ok(c > b, `${c} > ${b}`);
});

test("concurrent calls yield unique nonces", async () => {
  const got = await Promise.all(Array.from({ length: 20 }, () => nextEscrowNonce()));
  assert.equal(new Set(got).size, got.length);
});
