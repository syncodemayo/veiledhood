import { UserBalance } from "../models/UserBalance.js";
import { Withdraw } from "../models/Withdraw.js";
import {
  ledgerCurrencyMatchKeys,
  normalizeLedgerCurrency,
} from "../util/ledgerCurrency.js";
import { buildAssetKey } from "../util/chainLedger.js";

export class InsufficientBalanceError extends Error {
  constructor() {
    super("Insufficient balance");
    this.name = "InsufficientBalanceError";
  }
}

export type RecordWithdrawResult =
  | { status: "created"; withdrawId: string }
  | { status: "duplicate" };

/** Off-chain ledger: same pattern as recordDeposit — create row, then decrement balance. */
export async function recordWithdraw(params: {
  address: string;
  chainId: number;
  currency: string;
  amount: string;
  txHash: string;
}): Promise<RecordWithdrawResult> {
  const { address, chainId, currency, amount, txHash } = params;
  const cur = normalizeLedgerCurrency(currency);
  const assetKey = buildAssetKey(chainId, cur);
  const keys = ledgerCurrencyMatchKeys(currency);
  const amountBn = BigInt(amount);

  const bal = await UserBalance.findOne({
    address,
    chainId,
    currency: { $in: keys },
  });
  const prev = bal ? BigInt(bal.totalAmount) : 0n;
  if (prev < amountBn) {
    throw new InsufficientBalanceError();
  }

  try {
    const doc = await Withdraw.create({
      address,
      chainId,
      assetKey,
      currency: cur,
      amount,
      txHash,
    });
    const next = (prev - amountBn).toString();
    await UserBalance.findOneAndUpdate(
      { address, chainId, assetKey },
      { $set: { address, chainId, assetKey, currency: cur, totalAmount: next } }
    );
    return { status: "created", withdrawId: doc._id.toString() };
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: number }).code === 11000
    ) {
      return { status: "duplicate" };
    }
    throw e;
  }
}
