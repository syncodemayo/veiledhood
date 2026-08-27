import { UserBalance } from "../models/UserBalance.js";
import {
  ledgerCurrencyMatchKeys,
  normalizeLedgerCurrency,
} from "../util/ledgerCurrency.js";
import { buildAssetKey } from "../util/chainLedger.js";

export function computeSplit(
  currentBalance: bigint,
  amount: bigint
): { userRemaining: bigint; escrowAmount: bigint } {
  if (amount <= 0n) throw new Error("amount must be positive");
  if (amount > currentBalance) {
    throw new Error(`amount ${amount} exceeds balance ${currentBalance}`);
  }
  return { userRemaining: currentBalance - amount, escrowAmount: amount };
}

/**
 * Debit `amount` from the user's ledger leaf and credit a fresh escrow leaf,
 * off-chain, on `chainId`. Conserves the total. Does NOT touch the Merkle root
 * — the caller (Plan 3 orchestrator) commits roots around this.
 */
export async function applyLedgerSplit(params: {
  userAddress: string;
  escrowAddress: string;
  chainId: number;
  currency: string;
  amount: bigint;
}): Promise<void> {
  const { userAddress, escrowAddress, chainId, currency, amount } = params;
  const cur = normalizeLedgerCurrency(currency);
  const keys = ledgerCurrencyMatchKeys(currency);
  const assetKey = buildAssetKey(chainId, cur);

  const userRow = await UserBalance.findOne({
    address: userAddress,
    chainId,
    currency: { $in: keys },
  }).lean<{ totalAmount?: string; currency?: string } | null>();

  const current = BigInt(userRow?.totalAmount ?? "0");
  const { userRemaining, escrowAmount } = computeSplit(current, amount);
  const recvKey = userRow?.currency ?? cur;

  await UserBalance.findOneAndUpdate(
    { address: userAddress, chainId, assetKey },
    {
      $set: {
        address: userAddress,
        chainId,
        assetKey,
        currency: recvKey,
        totalAmount: userRemaining.toString(),
      },
    },
    { upsert: true }
  );

  await UserBalance.findOneAndUpdate(
    { address: escrowAddress, chainId, assetKey },
    {
      $set: {
        address: escrowAddress,
        chainId,
        assetKey,
        currency: recvKey,
        totalAmount: escrowAmount.toString(),
      },
    },
    { upsert: true }
  );
}
