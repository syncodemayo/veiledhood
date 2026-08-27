import { UserBalance } from "../models/UserBalance.js";
import { buildAssetKey, DEFAULT_BASE_CHAIN_ID } from "../util/chainLedger.js";

/**
 * AI usage billing — debits a user's shielded USDC balance on Base.
 *
 * On-chain Merkle root reconciliation is handled by the existing
 * `/user/withdraw-signature` flow which already calls `commitMerkleRootFromDb`
 * before issuing each signature. So a DB-only debit here will be reflected on
 * chain the next time the user requests a withdraw. See:
 * `docs/phase-1/billing-design-A-prime.md` for the full race analysis.
 */

const USDC_BASE_LOWER = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const USDC_DECIMALS = 6;
const USDC_SCALE = 10n ** BigInt(USDC_DECIMALS);
/** Minimum debit per chat to amortize race risk on very-low-cost models. */
export const MIN_CHARGE_RAW_USDC = 1_000n; // 0.001 USDC

/**
 * Raw-USDC cost per 1k tokens (input + output combined). Updated when
 * SolRouter publishes new pricing or we whitelist new models. Conservative
 * upper bound — actual cost from SolRouter `cost` field overrides when present.
 */
const MODEL_PRICE_PER_1K_TOKENS_RAW_USDC: Record<string, bigint> = {
  "gpt-oss-20b": 100n,        // ~$0.0001/1k
  "qwen3-8b": 100n,           // ~$0.0001/1k
  "llama-3.1-8b": 100n,       // ~$0.0001/1k
  "gpt-4o-mini": 600n,        // ~$0.0006/1k
  "claude-sonnet": 30_000n,   // ~$0.03/1k (premium — not in default whitelist)
  "claude-sonnet-4": 30_000n,
  "gemini-flash": 800n,
};

export class InsufficientAiBalanceError extends Error {
  constructor(public have: bigint, public need: bigint) {
    super(
      `Insufficient shielded USDC for AI usage: have ${have.toString()} raw, need ${need.toString()} raw`,
    );
    this.name = "InsufficientAiBalanceError";
  }
}

function normalizeModelId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function modelPricePer1k(model: string): bigint {
  // Match exact key first, then a stripped form like "nosana:gpt-oss:20b" → "gpt-oss-20b".
  const exact = MODEL_PRICE_PER_1K_TOKENS_RAW_USDC[model];
  if (exact !== undefined) return exact;
  const normModel = normalizeModelId(model);
  for (const key of Object.keys(MODEL_PRICE_PER_1K_TOKENS_RAW_USDC)) {
    if (normModel.includes(normalizeModelId(key))) {
      return MODEL_PRICE_PER_1K_TOKENS_RAW_USDC[key]!;
    }
  }
  // Conservative fallback if we can't identify the model.
  return 1_000n;
}

/**
 * Compute raw-USDC charge for a completed chat call.
 *
 * Priority:
 *   1. SolRouter `cost` field (USDC dollar value, e.g. 0.000456) → ceil to raw units
 *   2. Fallback: `(tokensIn + tokensOut) * pricePerK / 1000`
 *   3. Floor at `MIN_CHARGE_RAW_USDC` so micro-calls still bill something meaningful.
 */
export function computeChargeRawUsdc(input: {
  model: string;
  costUsdc: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
}): bigint {
  let raw: bigint;
  const parsedCost = input.costUsdc != null ? Number(input.costUsdc) : NaN;
  if (Number.isFinite(parsedCost) && parsedCost > 0) {
    raw = BigInt(Math.ceil(parsedCost * Number(USDC_SCALE)));
  } else {
    const tokens = (input.tokensIn ?? 0) + (input.tokensOut ?? 0) || 100;
    raw = (BigInt(tokens) * modelPricePer1k(input.model)) / 1000n;
  }
  return raw < MIN_CHARGE_RAW_USDC ? MIN_CHARGE_RAW_USDC : raw;
}

function usdcAssetKey(): string {
  return buildAssetKey(DEFAULT_BASE_CHAIN_ID, USDC_BASE_LOWER);
}

/**
 * Read user's current shielded USDC (Base) balance in raw 6-dec units.
 * Returns 0n if no row exists.
 */
export async function getShieldedUsdcBalanceRaw(walletAddress: string): Promise<bigint> {
  const row = await UserBalance.findOne({
    address: walletAddress.toLowerCase(),
    chainId: DEFAULT_BASE_CHAIN_ID,
    assetKey: usdcAssetKey(),
  }).lean<{ totalAmount: string } | null>();
  if (!row) return 0n;
  return /^\d+$/.test(row.totalAmount) ? BigInt(row.totalAmount) : 0n;
}

/**
 * Atomic conditional decrement. Returns the new balance, or throws
 * `InsufficientAiBalanceError` if pre-state was too low, or a generic
 * error on a CAS miss (caller can retry once).
 *
 * Implementation: `findOneAndUpdate` with the previous `totalAmount` in the
 * filter, providing optimistic concurrency without a separate version field.
 */
export async function debitShieldedUsdc(
  walletAddress: string,
  amountRaw: bigint,
): Promise<{ before: bigint; after: bigint }> {
  const addr = walletAddress.toLowerCase();
  const assetKey = usdcAssetKey();
  const RETRIES = 3;
  let lastBefore = 0n;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const row = await UserBalance.findOne({
      address: addr,
      chainId: DEFAULT_BASE_CHAIN_ID,
      assetKey,
    }).lean<{ totalAmount: string } | null>();
    const before =
      row && /^\d+$/.test(row.totalAmount) ? BigInt(row.totalAmount) : 0n;
    lastBefore = before;
    if (before < amountRaw) {
      throw new InsufficientAiBalanceError(before, amountRaw);
    }
    const after = before - amountRaw;
    const result = await UserBalance.updateOne(
      { address: addr, chainId: DEFAULT_BASE_CHAIN_ID, assetKey, totalAmount: before.toString() },
      { $set: { totalAmount: after.toString() } },
    );
    if (result.modifiedCount === 1) return { before, after };
    // CAS miss — concurrent debit (another chat or a transfer). Retry.
  }
  throw new Error(
    `Failed to debit shielded USDC after ${RETRIES} CAS attempts (last before=${lastBefore.toString()})`,
  );
}

/** Convenience: format raw-USDC for display ("0.001234"). Drops trailing zeros. */
export function formatUsdcRaw(raw: bigint, maxFractionDigits = 6): string {
  const whole = raw / USDC_SCALE;
  const frac = raw % USDC_SCALE;
  const fracStr = frac
    .toString()
    .padStart(USDC_DECIMALS, "0")
    .replace(/0+$/, "");
  if (fracStr.length === 0) return whole.toString();
  return `${whole.toString()}.${fracStr.slice(0, maxFractionDigits)}`;
}
