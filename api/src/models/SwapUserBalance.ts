import mongoose, { Schema } from "mongoose";

export interface ISwapUserBalance {
  address: string;
  chainId: number;
  /** Raw ERC-20 token address (lowercase). `address(0)` = native ETH. */
  tokenAddress: string;
  totalAmount: string;
}

const swapUserBalanceSchema = new Schema<ISwapUserBalance>(
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
    tokenAddress: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^0x[a-f0-9]{40}$/,
    },
    totalAmount: {
      type: String,
      required: true,
      match: /^\d+$/,
      default: "0",
    },
  },
  { timestamps: false }
);

swapUserBalanceSchema.index(
  { address: 1, chainId: 1, tokenAddress: 1 },
  { unique: true }
);
swapUserBalanceSchema.index({ address: 1, chainId: 1 });

export const SwapUserBalance =
  mongoose.models.SwapUserBalance ??
  mongoose.model<ISwapUserBalance>("SwapUserBalance", swapUserBalanceSchema);
