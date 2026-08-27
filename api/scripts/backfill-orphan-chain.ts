/**
 * Backfill chainId + assetKey on rows where chainId is missing OR null.
 *
 * The earlier `backfill-chain-fields.ts` script only matched `{ $exists: false }`,
 * which misses rows that were inserted with `chainId: null`. This script targets
 * both shapes ({ $in: [null] } matches missing-or-null) so legacy data can be
 * re-anchored to the Base chain before the chainId-scoped withdraw query lands.
 *
 * Safe to re-run: every row is idempotent (sets the same chainId + assetKey).
 *
 * Usage:
 *   tsx api/scripts/backfill-orphan-chain.ts
 *
 * Reads MONGODB_URI from the API's loaded env (process.env or .env).
 */
import mongoose from "mongoose";
import { loadEnv } from "../src/config/env.js";
import { UserBalance } from "../src/models/UserBalance.js";
import { Deposit } from "../src/models/Deposit.js";
import { Withdraw } from "../src/models/Withdraw.js";
import { Transfer } from "../src/models/Transfer.js";
import { DEFAULT_BASE_CHAIN_ID } from "../src/util/chainLedger.js";

type Model =
  | typeof UserBalance
  | typeof Deposit
  | typeof Withdraw
  | typeof Transfer;

const NULL_OR_MISSING = { $in: [null] } as const;

async function backfillCollection(model: Model, chainId: number, includePayoutStatus: boolean): Promise<number> {
  const filter = { chainId: NULL_OR_MISSING };
  const baseSet: Record<string, unknown> = {
    chainId,
    assetKey: { $concat: [{ $toString: chainId }, ":", "$currency"] },
  };
  if (includePayoutStatus) {
    baseSet.payoutStatus = { $ifNull: ["$payoutStatus", "pending_payout"] };
  }
  const result = await model.updateMany(filter as never, [{ $set: baseSet }]);
  return result.modifiedCount ?? 0;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const baseChainId = env.BASE_CHAIN_ID ?? env.CHAIN_ID ?? DEFAULT_BASE_CHAIN_ID;

  console.log(`[backfill-orphan-chain] connecting…`);
  await mongoose.connect(env.MONGODB_URI);

  const before = {
    userbalances: await UserBalance.countDocuments({ chainId: NULL_OR_MISSING }),
    deposits: await Deposit.countDocuments({ chainId: NULL_OR_MISSING }),
    withdraws: await Withdraw.countDocuments({ chainId: NULL_OR_MISSING }),
    transfers: await Transfer.countDocuments({ chainId: NULL_OR_MISSING }),
  };
  console.log(`[backfill-orphan-chain] orphan counts before:`, before);

  const moved = {
    userbalances: await backfillCollection(UserBalance, baseChainId, false),
    deposits: await backfillCollection(Deposit, baseChainId, false),
    withdraws: await backfillCollection(Withdraw, baseChainId, false),
    transfers: await backfillCollection(Transfer, baseChainId, true),
  };
  console.log(`[backfill-orphan-chain] rows updated:`, moved);

  const after = {
    userbalances: await UserBalance.countDocuments({ chainId: NULL_OR_MISSING }),
    deposits: await Deposit.countDocuments({ chainId: NULL_OR_MISSING }),
    withdraws: await Withdraw.countDocuments({ chainId: NULL_OR_MISSING }),
    transfers: await Transfer.countDocuments({ chainId: NULL_OR_MISSING }),
  };
  console.log(`[backfill-orphan-chain] orphan counts after:`, after);

  await mongoose.disconnect();
  console.log(`[backfill-orphan-chain] done.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
