import { Transfer } from "../models/Transfer.js";
import { UserBalance } from "../models/UserBalance.js";
import {
  ledgerCurrencyMatchKeys,
  normalizeLedgerCurrency,
} from "../util/ledgerCurrency.js";
import { computeTransferTotalFees } from "../util/transferFees.js";
import { buildAssetKey } from "../util/chainLedger.js";

export class InsufficientBalanceError extends Error {
  constructor() {
    super("Insufficient balance");
    this.name = "InsufficientBalanceError";
  }
}

export class TransferTreasuryRecipientError extends Error {
  constructor() {
    super("Transfer recipient cannot be the fee treasury ledger address");
    this.name = "TransferTreasuryRecipientError";
  }
}

export type TransferFeeConfig = {
  fixed: bigint;
  bps: number;
  /** Lowercase 0x address when fees apply; may be null when both fee components are zero */
  treasuryLedgerAddress: string | null;
};

export type RecordTransferResult =
  | { status: "created"; transferId: string }
  | { status: "duplicate"; transferId: string };

/** Off-chain ledger: create row keyed by `idempotencyKey`, then adjust balances. */
export async function recordTransfer(params: {
  fromAddress: string;
  toAddress: string;
  chainId: number;
  currency: string;
  amount: string;
  idempotencyKey: string;
  feeConfig: TransferFeeConfig;
  senderNextAmount?: bigint;
  recipientNextAmount?: bigint;
}): Promise<RecordTransferResult> {
  const {
    fromAddress,
    toAddress,
    chainId,
    currency,
    amount,
    idempotencyKey,
    feeConfig,
    senderNextAmount,
    recipientNextAmount,
  } =
    params;
  const cur = normalizeLedgerCurrency(currency);
  const assetKey = buildAssetKey(chainId, cur);
  const keys = ledgerCurrencyMatchKeys(currency);
  const amountBn = BigInt(amount);
  const { fixed, bps, treasuryLedgerAddress } = feeConfig;
  const totalFees = computeTransferTotalFees(amountBn, fixed, bps);
  const totalDebit = amountBn + totalFees;

  if (fromAddress === toAddress) {
    throw new Error("Self-transfer is not allowed");
  }

  if (totalFees > 0n) {
    if (!treasuryLedgerAddress) {
      throw new Error(
        "Gas and platform fees are enabled but treasury ledger address is missing"
      );
    }
    if (toAddress === treasuryLedgerAddress) {
      throw new TransferTreasuryRecipientError();
    }
  }

  const senderBal = await UserBalance.findOne({
    address: fromAddress,
    chainId,
    currency: { $in: keys },
  });
  const senderPrev = senderBal ? BigInt(senderBal.totalAmount) : 0n;
  const debitFromSender = totalFees === 0n ? amountBn : totalDebit;
  if (senderPrev < debitFromSender) {
    throw new InsufficientBalanceError();
  }

  const recvBal = await UserBalance.findOne({
    address: toAddress,
    chainId,
    currency: { $in: keys },
  });
  const recvPrev = recvBal ? BigInt(recvBal.totalAmount) : 0n;

  try {
    const doc = await Transfer.create({
      fromAddress,
      toAddress,
      chainId,
      assetKey,
      currency: cur,
      amount,
      idempotencyKey,
    });

    await UserBalance.findOneAndUpdate(
      { address: fromAddress, chainId, assetKey },
      {
        $set: {
          address: fromAddress,
          chainId,
          assetKey,
          currency: cur,
          totalAmount: (senderNextAmount ?? (senderPrev - debitFromSender)).toString(),
        },
      },
      { upsert: true }
    );

    await UserBalance.findOneAndUpdate(
      { address: toAddress, chainId, assetKey },
      {
        $set: {
          address: toAddress,
          chainId,
          assetKey,
          currency: cur,
          totalAmount: (recipientNextAmount ?? (recvPrev + amountBn)).toString(),
        },
      },
      { upsert: true }
    );

    if (totalFees > 0n && treasuryLedgerAddress) {
      const treasBal = await UserBalance.findOne({
        address: treasuryLedgerAddress,
        chainId,
        currency: { $in: keys },
      });
      const treasPrev = treasBal ? BigInt(treasBal.totalAmount) : 0n;
      await UserBalance.findOneAndUpdate(
        {
          address: treasuryLedgerAddress,
          chainId,
          assetKey: buildAssetKey(chainId, cur),
        },
        {
          $set: {
            address: treasuryLedgerAddress,
            chainId,
            assetKey: buildAssetKey(chainId, cur),
            currency: cur,
            totalAmount: (treasPrev + totalFees).toString(),
          },
        },
        { upsert: true }
      );
    }

    return { status: "created", transferId: doc._id.toString() };
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: number }).code === 11000
    ) {
      const existing = await Transfer.findOne({ idempotencyKey })
        .select("_id")
        .lean<{ _id: { toString(): string } } | null>();
      return {
        status: "duplicate",
        transferId: existing?._id?.toString() ?? "",
      };
    }
    throw e;
  }
}
