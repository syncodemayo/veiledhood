/**
 * Seed a fake shielded USDC balance for local AI billing tests.
 * Usage: tsx api/scripts/seed-test-usdc.ts 0x1111... 5000000  (= 5 USDC raw 6-dec)
 */
import mongoose from "mongoose";
import { loadEnv } from "../src/config/env.js";
import { UserBalance } from "../src/models/UserBalance.js";
import { buildAssetKey, DEFAULT_BASE_CHAIN_ID } from "../src/util/chainLedger.js";

const USDC_BASE_LOWER = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const wallet = (process.argv[2] ?? "0x1111111111111111111111111111111111111111").toLowerCase();
const rawAmount = process.argv[3] ?? "5000000";

const env = loadEnv();
await mongoose.connect(env.MONGODB_URI);
const assetKey = buildAssetKey(DEFAULT_BASE_CHAIN_ID, USDC_BASE_LOWER);
await UserBalance.findOneAndUpdate(
  { address: wallet, chainId: DEFAULT_BASE_CHAIN_ID, assetKey },
  {
    $set: {
      address: wallet,
      chainId: DEFAULT_BASE_CHAIN_ID,
      assetKey,
      currency: USDC_BASE_LOWER,
      totalAmount: rawAmount,
    },
  },
  { upsert: true },
);
console.log(`seeded ${wallet} chainId=${DEFAULT_BASE_CHAIN_ID} usdc=${rawAmount} (${Number(rawAmount) / 1e6} USDC)`);
await mongoose.disconnect();
