import mongoose, { Schema } from "mongoose";

/** State-machine order matters: index 0 is the initial state. */
export const BRIDGE_STATUSES = [
  "created",
  "source_split",
  "source_withdrawn",
  "bridge_submitted",
  "bridge_fulfilled",
  "dest_deposited",
  "dest_credited",
  "complete",
  "failed",
  "refunded",
] as const;

export type BridgeStatus = (typeof BRIDGE_STATUSES)[number];

export interface IBridge {
  /** Server-generated id; idempotency anchor for the whole bridge. */
  bridgeId: string;
  /** The user whose shielded balance is moving (lowercased). */
  userAddress: string;
  sourceChainId: number;
  destChainId: number;
  /** Ledger currency, e.g. "USDC" or the native key. */
  currency: string;
  /** Requested amount to bridge, base units, decimal string. */
  amountRequested: string;
  /** Actual amount that landed on the destination after bridge fees. */
  amountReceived?: string;
  /** Monotonic index for deterministic escrow HD derivation. */
  escrowNonce?: number;
  /** Fresh escrow address that receives the source adminWithdraw + sends the bridge. */
  sourceEscrowAddress?: string;
  /** Fresh escrow address that receives the bridge + deposits on the destination. */
  destEscrowAddress?: string;
  /** Fresh shielded address credited on the destination ledger. */
  destShieldedAddress?: string;
  /** deBridge DLN order id, once created. */
  deBridgeOrderId?: string;
  status: BridgeStatus;
  // Per-leg tx hashes (populated as the state machine advances).
  sourceRootBeforeTxHash?: string;
  sourceWithdrawTxHash?: string;
  sourceRootAfterTxHash?: string;
  bridgeTxHash?: string;
  destDepositTxHash?: string;
  destRootAfterTxHash?: string;
  error?: string;
  createdAt: Date;
}

const HASH = { type: String, lowercase: true, match: /^0x[a-f0-9]{64}$/, sparse: true };
const ADDR = { type: String, lowercase: true, trim: true, match: /^0x[a-f0-9]{40}$/ };

const bridgeSchema = new Schema<IBridge>(
  {
    bridgeId: { type: String, required: true, unique: true, trim: true, minlength: 8, maxlength: 64 },
    userAddress: { ...ADDR, required: true },
    sourceChainId: { type: Number, required: true, min: 1 },
    destChainId: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, trim: true, minlength: 1 },
    amountRequested: { type: String, required: true, match: /^\d+$/ },
    amountReceived: { type: String, match: /^\d+$/, sparse: true },
    escrowNonce: { type: Number, min: 0, sparse: true },
    sourceEscrowAddress: { ...ADDR, sparse: true },
    destEscrowAddress: { ...ADDR, sparse: true },
    destShieldedAddress: { ...ADDR, sparse: true },
    deBridgeOrderId: { type: String, trim: true, sparse: true },
    status: { type: String, required: true, enum: BRIDGE_STATUSES, default: "created" },
    sourceRootBeforeTxHash: HASH,
    sourceWithdrawTxHash: HASH,
    sourceRootAfterTxHash: HASH,
    bridgeTxHash: HASH,
    destDepositTxHash: HASH,
    destRootAfterTxHash: HASH,
    error: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

// Resume-on-boot scans non-terminal statuses; user activity lists by user.
bridgeSchema.index({ status: 1, createdAt: 1 });
bridgeSchema.index({ userAddress: 1, createdAt: -1 });

export const Bridge =
  mongoose.models.Bridge ?? mongoose.model<IBridge>("Bridge", bridgeSchema);
