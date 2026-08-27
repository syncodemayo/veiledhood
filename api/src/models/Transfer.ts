import mongoose, { Schema } from "mongoose";

export interface ITransfer {
  fromAddress: string;
  toAddress: string;
  chainId: number;
  assetKey: string;
  currency: string;
  amount: string;
  /** Client-supplied idempotency key (UUID). */
  idempotencyKey: string;
  createdAt: Date;
  /** `updateMerkleRoot` after DB transfer (root #2). */
  merkleAfterTransferTxHash?: string;
  /** On-chain `adminWithdraw` paying the recipient. */
  adminWithdrawTxHash?: string;
  /** Final `updateMerkleRoot` after recipient ledger zeroed (root #3). */
  merkleAfterPayoutTxHash?: string;
  payoutError?: string;
  payoutStatus?: "pending_payout" | "payout_completed" | "payout_failed";
}

const transferSchema = new Schema<ITransfer>(
  {
    fromAddress: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^0x[a-f0-9]{40}$/,
    },
    toAddress: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^0x[a-f0-9]{40}$/,
    },
    chainId: {
      type: Number,
      required: true,
      min: 1,
    },
    assetKey: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
    currency: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: String,
      required: true,
      match: /^\d+$/,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 8,
      maxlength: 128,
    },
    merkleAfterTransferTxHash: {
      type: String,
      lowercase: true,
      match: /^0x[a-f0-9]{64}$/,
      sparse: true,
    },
    adminWithdrawTxHash: {
      type: String,
      lowercase: true,
      match: /^0x[a-f0-9]{64}$/,
      sparse: true,
    },
    merkleAfterPayoutTxHash: {
      type: String,
      lowercase: true,
      match: /^0x[a-f0-9]{64}$/,
      sparse: true,
    },
    payoutError: { type: String, trim: true },
    payoutStatus: {
      type: String,
      enum: ["pending_payout", "payout_completed", "payout_failed"],
      default: "pending_payout",
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

transferSchema.index({ fromAddress: 1, createdAt: -1 });
transferSchema.index({ toAddress: 1, createdAt: -1 });
transferSchema.index({ chainId: 1, fromAddress: 1, createdAt: -1 });
transferSchema.index({ chainId: 1, toAddress: 1, createdAt: -1 });

export const Transfer =
  mongoose.models.Transfer ??
  mongoose.model<ITransfer>("Transfer", transferSchema);
