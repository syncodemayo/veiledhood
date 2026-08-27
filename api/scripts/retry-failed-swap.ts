/**
 * Resume a stuck swap by idempotencyKey (or list pending/failed swaps).
 *
 * Usage:
 *   npx tsx scripts/retry-failed-swap.ts                 # list candidates
 *   npx tsx scripts/retry-failed-swap.ts <idempotencyKey>
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { Swap } from "../src/models/Swap.js";
import { loadEnv } from "../src/config/env.js";
import { resumeSwapIfNeeded } from "../src/services/executeSwap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

async function main() {
  const env = loadEnv();
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI not set");
  await mongoose.connect(process.env.MONGODB_URI);

  const key = process.argv[2];
  if (!key) {
    const rows = await Swap.find({
      $or: [
        { status: "pending" },
        { status: "failed" },
        { status: "swap_completed", adminWithdrawTxHash: { $in: [null, undefined] } },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean<
        {
          idempotencyKey: string;
          fromAddress: string;
          status: string;
          swapTxHash?: string;
          adminWithdrawTxHash?: string;
          payoutError?: string;
          createdAt: Date;
        }[]
      >();

    console.log(`Stuck swaps (most recent 20):`);
    for (const r of rows) {
      console.log(
        `  ${r.idempotencyKey}  status=${r.status}  swap=${r.swapTxHash ? "yes" : "no"}  wd=${r.adminWithdrawTxHash ? "yes" : "no"}  ${r.createdAt.toISOString()}`,
      );
      if (r.payoutError) console.log(`     err: ${r.payoutError}`);
    }
    console.log(
      `\nPass an idempotencyKey to retry: npx tsx scripts/retry-failed-swap.ts <key>`,
    );
    await mongoose.disconnect();
    return;
  }

  console.log(`Resuming swap ${key}…`);
  await resumeSwapIfNeeded(env, key);
  const after = await Swap.findOne({ idempotencyKey: key })
    .select("status swapTxHash adminWithdrawTxHash payoutError")
    .lean<{ status?: string; swapTxHash?: string; adminWithdrawTxHash?: string; payoutError?: string } | null>();
  console.log("After:", after);

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
