import mongoose, { Schema } from "mongoose";

/**
 * Agent — an encrypted user-defined strategy (DCA / rebalance / yield) OR a
 * generic encrypted-data blob (kind="data") for arbitrary opaque payloads.
 *
 * The server never sees plaintext. The MCP server encrypts the payload with
 * the user's master AES key (wrapped + stored separately in agent_envelopes)
 * and sends opaque ciphertext here.
 *
 * Mongo stays blind: only `kind`, `status`, and lifecycle metadata are
 * readable. Plaintext field names like `amount`, `fromAsset`, `label`, etc.
 * MUST NEVER appear on documents in this collection.
 */
export type AgentKind = "dca" | "rebalance" | "yield" | "data";
export type AgentStatus = "active" | "paused" | "deleted";

export interface IAgent {
  address: string;
  agentId: string;
  kind: AgentKind;
  ciphertext: string; // base64-encoded AES-GCM ciphertext
  iv: string;         // base64-encoded 96-bit IV
  version: number;    // crypto schema version
  status: AgentStatus;
  lastRunAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const agentSchema = new Schema<IAgent>(
  {
    address: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^0x[a-f0-9]{40}$/,
    },
    agentId: { type: String, required: true, trim: true },
    kind: { type: String, required: true, enum: ["dca", "rebalance", "yield", "data"] },
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    version: { type: Number, required: true, default: 1 },
    status: {
      type: String,
      required: true,
      enum: ["active", "paused", "deleted"],
      default: "active",
    },
    lastRunAt: { type: Date, required: false },
  },
  { timestamps: true },
);

// Unique per-owner agentId. Avoids collision and gives us fast lookups.
agentSchema.index({ address: 1, agentId: 1 }, { unique: true });
// Fast list of active agents per owner.
agentSchema.index({ address: 1, status: 1 });

export const Agent =
  mongoose.models.Agent ?? mongoose.model<IAgent>("Agent", agentSchema);
