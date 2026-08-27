import { Deposit } from "../models/Deposit.js";
import { UserBalance } from "../models/UserBalance.js";
import {
  ledgerCurrencyMatchKeys,
  normalizeLedgerCurrency,
} from "../util/ledgerCurrency.js";
import { buildAssetKey } from "../util/chainLedger.js";

export type RecordDepositResult =
  | { status: "created"; depositId: string }
  | { status: "duplicate" };

export async function recordDeposit(params: {
  address: string;
  chainId: number;
  currency: string;
  amount: string;
  txHash: string;
}): Promise<RecordDepositResult> {
  const { address, chainId, currency, amount, txHash } = params;
  const cur = normalizeLedgerCurrency(currency);
  const assetKey = buildAssetKey(chainId, cur);
  const keys = ledgerCurrencyMatchKeys(currency);

  try {
    const doc = await Deposit.create({
      address,
      chainId,
      assetKey,
      currency: cur,
      amount,
      txHash,
    });
    const bal = await UserBalance.findOne({
      address,
      chainId,
      currency: { $in: keys },
    });
    const prev = bal ? BigInt(bal.totalAmount) : 0n;
    const next = (prev + BigInt(amount)).toString();
    await UserBalance.findOneAndUpdate(
      { address, chainId, assetKey },
      { $set: { address, chainId, assetKey, currency: cur, totalAmount: next } },
      { upsert: true }
    );
    return { status: "created", depositId: doc._id.toString() };
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
