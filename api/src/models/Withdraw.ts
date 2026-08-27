import mongoose, { Schema } from "mongoose";

export interface IWithdraw {
  address: string;
  chainId: number;
  assetKey: string;
  currency: string;
  amount: string;
  txHash: string;
  createdAt: Date;
}

const withdrawSchema = new Schema<IWithdraw>(
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

withdrawSchema.index({ chainId: 1, txHash: 1 }, { unique: true });
withdrawSchema.index({ address: 1, chainId: 1, createdAt: -1 });

export const Withdraw =
  mongoose.models.Withdraw ?? mongoose.model<IWithdraw>("Withdraw", withdrawSchema);
