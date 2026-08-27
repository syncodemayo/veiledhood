import mongoose, { Schema } from "mongoose";

/**
 * AgentEnvelope — the user's master AES key wrapped with their passphrase
 * (PBKDF2 + AES-GCM). Server stores opaque ciphertext only. One doc per
 * wallet address. See packages/agent-crypto/src/envelope.ts for the shape.
 */
export interface IAgentEnvelope {
  address: string;
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const envelopeSchema = new Schema<IAgentEnvelope>(
  {
    address: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^0x[a-f0-9]{40}$/,
    },
    salt: { type: String, required: true },
    iv: { type: String, required: true },
    ciphertext: { type: String, required: true },
    iterations: { type: Number, required: true, min: 1 },
    version: { type: Number, required: true, default: 1 },
  },
  { timestamps: true },
);

export const AgentEnvelope =
  mongoose.models.AgentEnvelope ??
  mongoose.model<IAgentEnvelope>("AgentEnvelope", envelopeSchema);
