/**
 * One-off: backfill missing `adminWithdrawTxHash` on Swap rows that were
 * marked `payout_completed` (or `swap_completed`) but lost the tx hash
 * (e.g. process restart between the on-chain receipt and the DB write).
 *
 * Looks up the most recent `AdminWithdrawal(user, token)` event on the
 * VeilSwap vault for each affected row and writes the tx hash back.
 *
 * Usage:
 *   tsx scripts/backfill-admin-withdraw-tx.ts            # dry-run
 *   tsx scripts/backfill-admin-withdraw-tx.ts --apply    # write to DB
 */
import "dotenv/config";
import mongoose from "mongoose";
import { ethers } from "ethers";
import { Swap } from "../src/models/Swap.js";
import { VEILSWAP_ABI } from "../src/abi/veilSwap.js";
import { createJsonRpcProvider } from "../src/util/jsonRpcProvider.js";

const APPLY = process.argv.includes("--apply");
const LOOKBACK_BLOCKS = Number(process.env.BACKFILL_LOOKBACK_BLOCKS ?? 50_000);

function envRequired(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const mongoUri = envRequired("MONGODB_URI");
  const rpc = envRequired("RPC_URL");
  const vault = ethers.getAddress(envRequired("VEILSWAP_ADDRESS"));
  const chainId = Number(process.env.CHAIN_ID ?? 8453);

  await mongoose.connect(mongoUri);
  console.log(`Connected to Mongo (chainId=${chainId})`);

  const provider = createJsonRpcProvider(rpc, chainId);
  const contract = new ethers.Contract(vault, VEILSWAP_ABI, provider);
  const latest = await provider.getBlockNumber();
  const fromBlock = Math.max(0, latest - LOOKBACK_BLOCKS);
  console.log(`Scanning blocks ${fromBlock}…${latest}`);

  const candidates = await Swap.find({
    chainId,
    status: { $in: ["payout_completed", "swap_completed"] },
    $or: [
      { adminWithdrawTxHash: { $exists: false } },
      { adminWithdrawTxHash: null },
      { adminWithdrawTxHash: "" },
    ],
    swapTxHash: { $exists: true, $ne: null },
  })
    .select(
      "idempotencyKey toAddress tokenOut amountOut status swapTxHash createdAt"
    )
    .lean<
      {
        idempotencyKey: string;
        toAddress: string;
        tokenOut: string;
        amountOut?: string;
        status: string;
        swapTxHash: string;
        createdAt: Date;
      }[]
    >();

  console.log(`Found ${candidates.length} candidate swap(s) to backfill`);

  if (candidates.length === 0) {
    await mongoose.disconnect();
    return;
  }

  let recovered = 0;
  for (const swap of candidates) {
    const user = ethers.getAddress(swap.toAddress);
    const token = ethers.getAddress(swap.tokenOut);

    const filter = contract.filters.AdminWithdrawal(user, token);
    const events = await contract.queryFilter(filter, fromBlock, latest);

    console.log(
      `\n  ${swap.idempotencyKey} (${swap.status}) → ` +
        `user=${user.slice(0, 10)}… tok=${token.slice(0, 10)}…  ` +
        `events=${events.length}`
    );

    if (events.length === 0) {
      console.log("    no matching AdminWithdrawal event in window — skipping");
      continue;
    }

    // Prefer the event with matching amount; fall back to most recent.
    let chosen = events[events.length - 1];
    if (swap.amountOut) {
      const expected = BigInt(swap.amountOut);
      const match = events.find((ev) => {
        // ethers v6 EventLog has args; LogDescription has args after parse.
        // For pre-decoded EventLog (when ABI matches), `args` is present.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args = (ev as any).args as readonly unknown[] | undefined;
        if (!args) return false;
        try {
          return BigInt(args[2] as bigint | string) === expected;
        } catch {
          return false;
        }
      });
      if (match) chosen = match;
    }

    console.log(`    → ${chosen.transactionHash}`);

    if (APPLY) {
      await Swap.updateOne(
        { idempotencyKey: swap.idempotencyKey },
        {
          $set: {
            adminWithdrawTxHash: chosen.transactionHash,
            status: "payout_completed",
          },
        }
      );
      recovered += 1;
    }
  }

  console.log(
    `\nDone. ${APPLY ? `Updated ${recovered} swap(s).` : "Dry-run — pass --apply to write."}`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
