import mongoose, { Schema } from "mongoose";

export interface ISwapDeposit {
  address: string;
  chainId: number;
  token: string;
  amount: string;
  txHash: string;
  createdAt: Date;
}

const swapDepositSchema = new Schema<ISwapDeposit>(
  {
    address: {
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
    token: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^0x[a-f0-9]{40}$/,
    },
    amount: {
      type: String,
      required: true,
      match: /^\d+$/,
    },
    txHash: {
      type: String,
      required: true,
      lowercase: true,
      match: /^0x[a-f0-9]{64}$/,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

swapDepositSchema.index({ chainId: 1, txHash: 1 }, { unique: true });
swapDepositSchema.index({ address: 1, chainId: 1, createdAt: -1 });

export const SwapDeposit =
  mongoose.models.SwapDeposit ??
  mongoose.model<ISwapDeposit>("SwapDeposit", swapDepositSchema);
