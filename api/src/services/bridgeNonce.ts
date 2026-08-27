import { Counter } from "../models/Counter.js";

const BRIDGE_ESCROW_COUNTER = "bridgeEscrowNonce";

/** Atomically allocate the next unique escrow HD index. */
export async function nextEscrowNonce(): Promise<number> {
  const doc = await Counter.findByIdAndUpdate(
    BRIDGE_ESCROW_COUNTER,
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  ).lean<{ seq: number }>();
  return doc!.seq;
}
