import mongoose, { Schema } from "mongoose";

export interface IUserBalance {
  address: string;
  chainId: number;
  assetKey: string;
  currency: string;
  totalAmount: string;
}

const userBalanceSchema = new Schema<IUserBalance>(
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
      minlength: 1,
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

userBalanceSchema.index({ address: 1, chainId: 1, assetKey: 1 }, { unique: true });
userBalanceSchema.index({ address: 1, chainId: 1 });

export const UserBalance =
  mongoose.models.UserBalance ??
  mongoose.model<IUserBalance>("UserBalance", userBalanceSchema);
