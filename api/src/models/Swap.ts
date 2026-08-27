import mongoose, { Schema } from "mongoose";

export type SwapStatus =
  | "pending"
  | "swap_completed"
  | "payout_completed"
  | "failed";

export interface ISwap {
  idempotencyKey: string;
  fromAddress: string;
  toAddress: string;
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut?: string;
  amountOutMin: string;
  poolKey: {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  };
  merkleBeforeSwapTxHash?: string;
  swapTxHash?: string;
  merkleAfterSwapTxHash?: string;
  adminWithdrawTxHash?: string;
  status: SwapStatus;
  payoutError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const swapSchema = new Schema<ISwap>(
  {
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 8,
      maxlength: 128,
    },
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
    tokenIn: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^0x[a-f0-9]{40}$/,
    },
    tokenOut: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^0x[a-f0-9]{40}$/,
    },
    amountIn: {
      type: String,
      required: true,
      match: /^\d+$/,
    },
    amountOut: {
      type: String,
      match: /^\d+$/,
      sparse: true,
    },
    amountOutMin: {
      type: String,
      required: true,
      match: /^\d+$/,
    },
    poolKey: {
      type: {
        currency0: { type: String, required: true, lowercase: true, match: /^0x[a-f0-9]{40}$/ },
        currency1: { type: String, required: true, lowercase: true, match: /^0x[a-f0-9]{40}$/ },
        fee:        { type: Number, required: true },
        tickSpacing:{ type: Number, required: true },
        hooks:      { type: String, required: true, lowercase: true, match: /^0x[a-f0-9]{40}$/ },
      },
      required: true,
      _id: false,
    },
    merkleBeforeSwapTxHash: {
      type: String,
      lowercase: true,
      match: /^0x[a-f0-9]{64}$/,
      sparse: true,
    },
    swapTxHash: {
      type: String,
      lowercase: true,
      match: /^0x[a-f0-9]{64}$/,
      sparse: true,
    },
    merkleAfterSwapTxHash: {
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
    status: {
      type: String,
      enum: ["pending", "swap_completed", "payout_completed", "failed"],
      default: "pending",
    },
    payoutError: { type: String, trim: true },
  },
  { timestamps: true }
);

swapSchema.index({ fromAddress: 1, createdAt: -1 });
swapSchema.index({ chainId: 1, fromAddress: 1, createdAt: -1 });

export const Swap =
  mongoose.models.Swap ?? mongoose.model<ISwap>("Swap", swapSchema);
