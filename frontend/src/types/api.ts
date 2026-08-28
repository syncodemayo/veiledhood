export interface AuthVerifyResponse {
  token: string;
  address: string;
  exp?: number;
}

export interface AuthValidateResponse {
  valid: boolean;
  address?: string;
  hasVaultBalance: boolean;
  reason?: "invalid" | "expired";
  exp?: number;
}

export interface MergedBalance {
  currency: string;
  totalAmount: string;
  chainId: number;
}

export interface UserMeResponse {
  address: string;
  balances: MergedBalance[];
  hasVaultBalance: boolean;
}

export type ActivityItem =
  | { kind: "deposit"; amount: string; currency: string; chainId: number; createdAt: string; txHash: string }
  | { kind: "withdraw"; amount: string; currency: string; chainId: number; createdAt: string; txHash: string }
  | {
      kind: "transfer";
      direction: "in" | "out";
      amount: string;
      currency: string;
      chainId: number;
      createdAt: string;
      idempotencyKey: string;
      payoutStatus?: "pending_payout" | "payout_completed" | "payout_failed";
      adminWithdrawTxHash?: string | null;
      merkleAfterTransferTxHash?: string | null;
      merkleAfterPayoutTxHash?: string | null;
      counterparty: string;
    }
  | {
      kind: "swap";
      tokenIn: string;
      tokenOut: string;
      amountIn: string;
      amountOut?: string;
      chainId: number;
      createdAt: string;
      idempotencyKey: string;
      status: string;
      swapTxHash?: string | null;
      adminWithdrawTxHash?: string | null;
    };

export interface UserActivityResponse {
  items: ActivityItem[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ShieldedAssetView {
  currency: string;
  amount: string;
  decimals?: number;
  symbol?: string;
  usdValue: number | null;
}

export interface PublicTokenView {
  address: string;
  symbol: string;
  decimals: number;
  balance: string;
  priceUsd: number | null;
  usdValue: number | null;
}

export interface PublicNativeView {
  symbol: string;
  balance: string;
  priceUsd: number | null;
  usdValue: number | null;
}

export interface WalletContextFull {
  address: string;
  chainId: number;
  shielded: { balances: ShieldedAssetView[]; totalUsd: number | null };
  public: { native: PublicNativeView; tokens: PublicTokenView[]; totalUsd: number | null };
  totalUsd: number | null;
  at: number;
  privacy: { decoyRatio: number; batchWindowMs: number };
}

export interface WithdrawSignatureResponse {
  merkleRoot: string;
  proof: string[];
  signature: string;
  deadline: string;
  nullifier: string;
  chainId: string;
  verifyingContract: string;
  domain: { name: string; version: string; chainId: string; verifyingContract: string };
}

export interface TransferFeeQuote {
  amount: string;
  currency: string;
  chainId: number;
  recipientReceives: string;
  fees: { fixed: string; bps: number; bpsFee: string; total: string };
  senderTotalDebit: string;
}

export interface TransferResponse {
  status: "created" | "duplicate";
  transferId: string;
  from: string;
  to: string;
  currency: string;
  amount: string;
  idempotencyKey: string;
  chainId: number;
  chain?: { adminWithdrawTxHash: string };
}

export interface AgentRecord {
  agentId: string;
  kind: "dca" | "rebalance" | "yield" | "data";
  ciphertext: string;
  iv: string;
  version: number;
  status: "active" | "paused" | "deleted";
  lastRunAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AiConfigResponse {
  enabled: boolean;
  torEnabled: boolean;
  models: string[];
  quotaPerMin: number;
  quotaPerDay: number;
  minChargeRawUsdc: string;
  shieldedUsdcRaw: string;
  usage: { minRemaining: number; dayRemaining: number };
}

export interface AiChatResponse {
  message: string;
  modelUsed: string;
  chargeRawUsdc?: string;
  balanceAfterRawUsdc?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  elapsedMs: number;
}

export interface AgentEnvelopeWireBody {
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
  version: number;
}

export interface ExistingAgentEnvelope extends AgentEnvelopeWireBody {
  createdAt: string;
  updatedAt: string;
}

export interface VeilswapPoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

export interface VeilswapPair {
  tokenIn: string;
  tokenOut: string;
  symbolIn: string;
  symbolOut: string;
  decimalsIn: number;
  decimalsOut: number;
  poolKey: VeilswapPoolKey;
}

export interface VeilswapQuoteResponse {
  amountOut: string;
  poolKey: VeilswapPoolKey;
}

export interface VeilswapDepositResponse {
  status: "created" | "duplicate";
}

export interface VeilswapMeResponse {
  balances: { tokenAddress: string; totalAmount: string; chainId: number }[];
}

export interface SwapStatusResponse {
  idempotencyKey: string;
  status: "pending" | "swap_completed" | "payout_completed" | "failed";
  amountOut?: string;
  swapTxHash?: string;
  adminWithdrawTxHash?: string;
  payoutError?: string;
}

export interface X402DiscoveryResponse {
  name: string;
  homepage: string;
  enabled: boolean;
  endpoints: { path: string; method: string; description: string; resource: string; price: { atomic: string; asset: string; network: string } }[];
}
