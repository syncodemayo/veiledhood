import mongoose from "mongoose";
import { loadEnv } from "../src/config/env.js";
import { UserBalance } from "../src/models/UserBalance.js";
import { Deposit } from "../src/models/Deposit.js";
import { Withdraw } from "../src/models/Withdraw.js";
import { Transfer } from "../src/models/Transfer.js";
import { DEFAULT_BASE_CHAIN_ID } from "../src/util/chainLedger.js";

async function main() {
  const env = loadEnv();
  const baseChainId = env.BASE_CHAIN_ID ?? env.CHAIN_ID ?? DEFAULT_BASE_CHAIN_ID;

  await mongoose.connect(env.MONGODB_URI);

  await UserBalance.updateMany(
    { chainId: { $exists: false } },
    [{ $set: { chainId: baseChainId, assetKey: { $concat: [{ $toString: baseChainId }, ":", "$currency"] } } }]
  );
  await Deposit.updateMany(
    { chainId: { $exists: false } },
    [{ $set: { chainId: baseChainId, assetKey: { $concat: [{ $toString: baseChainId }, ":", "$currency"] } } }]
  );
  await Withdraw.updateMany(
    { chainId: { $exists: false } },
    [{ $set: { chainId: baseChainId, assetKey: { $concat: [{ $toString: baseChainId }, ":", "$currency"] } } }]
  );
  await Transfer.updateMany(
    { chainId: { $exists: false } },
    [
      {
        $set: {
          chainId: baseChainId,
          assetKey: { $concat: [{ $toString: baseChainId }, ":", "$currency"] },
          payoutStatus: { $ifNull: ["$payoutStatus", "pending_payout"] },
        },
      },
    ]
  );

  await mongoose.disconnect();
  console.log("Backfill complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

