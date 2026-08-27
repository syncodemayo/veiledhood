import mongoose, { Schema } from "mongoose";

export interface IUser {
  address: string;
  createdAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    address: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^0x[a-f0-9]{40}$/,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const User =
  mongoose.models.User ?? mongoose.model<IUser>("User", userSchema);
