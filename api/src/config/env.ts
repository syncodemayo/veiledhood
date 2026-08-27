import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const ethAddr = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address");
const ethPk = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "Invalid private key")
  .optional();

const feeConfigEntry = z.object({
  fixed: z.string().optional().default("0"),
  bps: z.number().int().min(0).max(10_000).optional().default(0),
});

function parseFeeConfigJson(raw: string | undefined): Record<string, z.infer<typeof feeConfigEntry>> {
  if (raw === undefined || raw.trim() === "") return {};
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const out: Record<string, z.infer<typeof feeConfigEntry>> = {};
  for (const [k, v] of Object.entries(parsed)) {
    const key = k.trim().toLowerCase();
    const entry = feeConfigEntry.parse(v);
    if (entry.fixed && !/^\d+$/.test(entry.fixed)) {
      throw new Error(`TRANSFER_FEE_CONFIG_JSON: ${key} fixed must be digits`);
    }
    out[key] = entry;
  }
  return out;
}

// --- Bridge (private Base<->Eth bridging) ---
// Exported so it can be unit-tested in isolation. Spread into the main schema.
export const BRIDGE_ENV_SHAPE = {
  /** Master switch; when false the /bridge routes reject. */
  BRIDGE_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** BIP-39 mnemonic for deriving fresh escrow wallets. SECRET — never log. */
  BRIDGE_ESCROW_SEED: z.string().min(1).optional(),
  /**
   * Private key that fronts native-ETH gas to the per-bridge escrow addresses.
   * SECRET — never log. Optional: when unset, falls back to ADMIN_PRIVATE_KEY
   * (the contract admin already signs adminWithdraw/updateMerkleRoot). Set this
   * to dedicate a separate hot wallet for gas top-ups (avoids nonce contention
   * with the admin signer). The privileged on-chain calls always use the admin
   * key regardless — this only covers the plain ETH gas-funding leg.
   */
  BRIDGE_GAS_PRIVATE_KEY: ethPk,
  /** deBridge DLN API base (overridable for staging/testnet). */
  DEBRIDGE_API_URL: z
    .string()
    .url()
    .default("https://dln.debridge.finance/v1.0"),
  /** deBridge order-status/tracking API base (different host from create-tx). */
  DEBRIDGE_STATS_API_URL: z
    .string()
    .url()
    .default("https://dln-api.debridge.finance/api"),
  /** Optional deBridge referral/affiliate code. */
  DEBRIDGE_REFERRAL_CODE: z.string().optional(),
  /** Veiledhood's own bridge fee in basis points (0..10000). */
  BRIDGE_FEE_BPS: z.coerce.number().int().min(0).max(10000).default(0),
  /** Max bridges per user per day. */
  BRIDGE_USER_DAILY_QUOTA: z.coerce.number().int().min(1).default(10),
} as const;

const envSchema = z.object({
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().optional(),
  LOGIN_MESSAGE: z.string().optional(),
  RPC_URL: z.string().min(1).optional(),
  /** Veiledhood vault (single contract for ERC-20 + ETH). */
  VAULT_ADDRESS: ethAddr.optional(),
  /**
   * Optional static chain id for `JsonRpcProvider` (fewer round-trips; recommended in production).
   */
  CHAIN_ID: z.coerce.number().int().positive().optional(),
  BASE_CHAIN_ID: z.coerce.number().int().positive().optional().default(8453),
  ETH_RPC_URL: z.string().min(1).optional(),
  ETH_VAULT_ADDRESS: ethAddr.optional(),
  ETH_CHAIN_ID: z.coerce.number().int().positive().optional(),
  /**
   * Admin key: `updateMerkleRoot`, `adminWithdraw`. Falls back to `DEPLOYER_PRIVATE_KEY` if unset.
   */
  ADMIN_PRIVATE_KEY: ethPk,
  DEPLOYER_PRIVATE_KEY: ethPk,
  /** EIP-712 `WithdrawAuth` signer (must match on-chain `_withdrawSigner`). */
  SIGNER_PRIVATE_KEY: ethPk,
  /** First block for `Deposited` scan when no cursor exists (inclusive floor). */
  MERKLE_INDEXER_FROM_BLOCK: z.coerce.number().int().min(0).default(0),
  /** Max `eth_getLogs` block span per query for deposit catch-up sync. */
  INDEXER_LOG_CHUNK_BLOCKS: z.coerce.number().int().positive().default(10),
  VEILEDHOOD_ETH_TRANSFER_FEE_BPS: z.coerce.number().int().min(0).max(10_000).optional().default(0),
  VEILEDHOOD_ETH_TRANSFER_FEE_FIXED: z.string().regex(/^\d+$/, "must be digits").optional().default("0"),
  /**
   * Per-token transfer fees: JSON map of currency key (`native` or `0x…` lowercase) → `{ fixed, bps }`.
   * `fixed` = raw token units per transfer (string digits). `bps` = 0–10000.
   */
  TRANSFER_FEE_CONFIG_JSON: z.string().optional(),
  TRANSFER_FEE_LEDGER_ADDRESS: z
    .string()
    .optional()
    .transform((s) => {
      if (s === undefined || s.trim() === "") return undefined;
      return s.trim().toLowerCase();
    })
    .refine((s) => s === undefined || /^0x[a-f0-9]{40}$/.test(s), {
      message: "TRANSFER_FEE_LEDGER_ADDRESS must be a valid 0x-prefixed 40-hex address",
    }),
  WITHDRAW_DEADLINE_MAX_SEC: z.coerce.number().int().positive().default(900),
  ...BRIDGE_ENV_SHAPE,
  /** VeilSwap contract address on Base (optional — enables swap routes). */
  VEILSWAP_ADDRESS: ethAddr.optional(),
  /** Swap fee in basis points (0–10000). Default 50 = 0.5%. */
  VEILSWAP_FEE_BPS: z.coerce.number().int().min(0).max(10_000).optional().default(0),
  /** Fixed fee in wei charged when tokenOut is native ETH. */
  VEILSWAP_FEE_FIXED_ETH: z.string().regex(/^\d+$/, "must be digits").optional().default("0"),
  /** Ledger address that accumulates swap fees (required when any fee is non-zero). */
  VEILSWAP_TREASURY_ADDRESS: z
    .string()
    .optional()
    .transform((s) => {
      if (s === undefined || s.trim() === "") return undefined;
      return s.trim().toLowerCase();
    })
    .refine((s) => s === undefined || /^0x[a-f0-9]{40}$/.test(s), {
      message: "VEILSWAP_TREASURY_ADDRESS must be a valid 0x-prefixed 40-hex address",
    }),
  /**
   * When set to "true", disables the on-chain deposit indexer, boot-time
   * transfer resume, and any other admin/state-mutating background jobs.
   * Use on dev/staging deployments that share the same on-chain vault as
   * prod — otherwise both indexers race to commit Merkle roots to the same
   * contract and clobber each other.
   */
  INDEXER_DISABLED: z
    .string()
    .optional()
    .transform((s) => (s ?? "").trim().toLowerCase() === "true"),
  /**
   * SolRouter API key (sk_solrouter_...). Funds inference + web search calls.
   * Pooled across all Veiledhood users behind the per-user rate limit.
   */
  SOLROUTER_API_KEY: z.string().min(20).optional(),
  /** Override SolRouter base URL (defaults to the SDK's built-in). */
  SOLROUTER_BASE_URL: z.string().url().optional(),
  /**
   * Comma-separated allowlist of SolRouter model IDs exposed to the chat UI.
   * Confirmed live on SolRouter as of 2026-05-21: gpt-oss-20b (cheap, open),
   * gpt-4o-mini (cheap, balanced). Other SDK-declared models (qwen3-8b,
   * llama-3.1-8b, gemini-flash, claude-sonnet) currently return
   * tee_unreachable — re-add when SolRouter wires them up.
   */
  AI_MODEL_WHITELIST: z
    .string()
    .optional()
    .default("gpt-oss-20b,gpt-4o-mini"),
  /** Tor SOCKS5 host the API connects to for outbound SolRouter calls. */
  TOR_SOCKS_HOST: z.string().default("127.0.0.1"),
  TOR_SOCKS_PORT: z.coerce.number().int().min(1).max(65535).default(9050),
  /**
   * Toggle to route SolRouter traffic through Tor. Disable for local dev
   * when the daemon isn't running; production should always be `true`.
   */
  TOR_ENABLED: z
    .string()
    .optional()
    .default("true")
    .transform((s) => s.trim().toLowerCase() === "true"),
  /** Per-user quota: messages per rolling 24h. */
  AI_RATE_LIMIT_PER_USER_PER_DAY: z.coerce.number().int().positive().default(50),
  /** Per-user quota: messages per rolling 60s. */
  AI_RATE_LIMIT_PER_USER_PER_MIN: z.coerce.number().int().positive().default(5),
  /** Redis connection URL for rate limit + future caching. */
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  /** Disable rate limiting entirely (testing only). Leave false in prod. */
  AI_RATE_LIMIT_DISABLED: z
    .string()
    .optional()
    .default("false")
    .transform((s) => s.trim().toLowerCase() === "true"),
  // === Encrypted Agents (Phase 2) ===
  /** Per-user CRUD rate limit (req/min). Default 30. */
  AGENTS_RATE_LIMIT_PER_USER_PER_MIN: z.coerce.number().int().min(1).max(1000).default(30),
  /** Per-user CRUD rate limit (req/day). Default 500. */
  AGENTS_RATE_LIMIT_PER_USER_PER_DAY: z.coerce.number().int().min(1).max(100000).default(500),
  /** Hard cap on agents stored per user. */
  AGENTS_MAX_PER_USER: z.coerce.number().int().min(1).max(1000).default(20),
  /** Max ciphertext bytes per agent (server enforces). 16KB default. */
  AGENTS_MAX_CIPHERTEXT_BYTES: z.coerce.number().int().min(512).max(262144).default(16384),
  /** Escape hatch for local dev. */
  AGENTS_RATE_LIMIT_DISABLED: z.coerce.boolean().default(false),
  // === Encrypted Data Storage ===
  /** Hard cap on encrypted-data blobs stored per user (kind="data"). */
  DATA_MAX_PER_USER: z.coerce.number().int().min(1).max(10_000).default(100),
  /**
   * Max ciphertext bytes per encrypted-data blob (kind="data").
   * Larger than agent cap because data blobs can be files / docs / JSON, not
   * just compact strategy params. 1 MB default.
   */
  DATA_MAX_CIPHERTEXT_BYTES: z.coerce.number().int().min(1024).max(10_485_760).default(1_048_576),
  // === Wallet Context (Phase 3) ===
  /** Per-user context route rate limit (req/min). Default 30. */
  CONTEXT_RATE_LIMIT_PER_USER_PER_MIN: z.coerce.number().int().min(1).max(1000).default(30),
  /** Per-user context route rate limit (req/day). Default 1000. */
  CONTEXT_RATE_LIMIT_PER_USER_PER_DAY: z.coerce.number().int().min(1).max(100000).default(1000),
  /** Disable context rate limit (testing only). */
  CONTEXT_RATE_LIMIT_DISABLED: z.coerce.boolean().default(false),
  /** Response cache TTL (seconds) for /context/* responses. */
  CONTEXT_CACHE_TTL_S: z.coerce.number().int().min(0).max(3600).default(60),
  // === RPC Pool (Phase 3) ===
  /** Multicall batching window in ms. Coalesces N user requests into 1 multicall. */
  RPC_POOL_BATCH_WINDOW_MS: z.coerce.number().int().min(0).max(1000).default(100),
  /** Decoy query ratio (0-1). 0.10 = 10% extra queries for k-anonymity. */
  RPC_POOL_DECOY_RATIO: z.coerce.number().min(0).max(0.5).default(0.1),
  /** Jitter max delay (ms) applied per outgoing RPC call. */
  RPC_POOL_JITTER_MAX_MS: z.coerce.number().int().min(0).max(500).default(50),
  /** Circuit breaker — errors per window before failover to secondary RPC. */
  RPC_POOL_FAILOVER_ERROR_THRESHOLD: z.coerce.number().int().min(1).default(5),
  /** Circuit breaker — error window (seconds). */
  RPC_POOL_FAILOVER_WINDOW_S: z.coerce.number().int().min(1).default(30),
  /** Optional secondary RPC for Base (used by circuit breaker). */
  BASE_RPC_URL_FALLBACK: z.string().min(1).optional(),
  /** Optional secondary RPC for Ethereum (used by circuit breaker). */
  ETH_RPC_URL_FALLBACK: z.string().min(1).optional(),
  // === Price Oracle (Phase 3) ===
  /** Optional CoinGecko API key (Pro/Demo) for fallback pricing. */
  COINGECKO_API_KEY: z.string().optional(),
  /** Pyth Hermes endpoint (HTTPS). */
  PYTH_HERMES_URL: z.string().url().default("https://hermes.pyth.network"),
  /** Price cache TTL (seconds). */
  PRICE_CACHE_TTL_S: z.coerce.number().int().min(0).max(3600).default(30),
  // === Stealth x402 (Phase 4 — ShroudFi + PayAI) ===
  /**
   * Master toggle. When false the entire x402 surface is dormant: middleware
   * skips, scanner doesn't start, /.well-known returns an empty catalog.
   */
  X402_ENABLED: z.coerce.boolean().default(false),
  /**
   * Chain ShroudFi runs on. 'base' = mainnet, 'baseSepolia' = testnet. Must
   * match the chain that USDC + the ERC-6538 registry live on.
   */
  SHROUDFI_CHAIN: z.enum(["base", "baseSepolia"]).default("base"),
  /**
   * Base RPC URL used by the ShroudFi transport. Separate from RPC_URL (which
   * the existing deposit indexer uses) so operators can point ShroudFi at a
   * different provider for privacy / cost segmentation. Required when
   * X402_ENABLED=true.
   */
  BASE_RPC_URL: z.string().url().optional(),
  /**
   * 32-byte hex master seed for the receiving ShroudAgent identity. Deriving
   * the meta-address from this seed at boot keeps deploys deterministic — the
   * meta-address printed in the boot log is what x402 challenges expose.
   *
   * Privacy: this seed lets ANY holder decrypt every payment to the
   * meta-address. Treat it like a withdraw key. Required when X402_ENABLED=true.
   */
  SHROUDFI_MASTER_SEED: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "32-byte hex required (with 0x prefix)")
    .optional(),
  /**
   * EOA private key the ShroudAgent uses to pay gas for `register()` and any
   * direct-sweep paths. Distinct from MASTER_SEED — leaking this only loses
   * the small ETH gas balance; leaking MASTER_SEED loses every customer
   * payment. Keep them on different secrets management surfaces.
   */
  SHROUDFI_AGENT_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "Invalid agent private key")
    .optional(),
  /**
   * Destination wallet for swept payments. Receives the USDC after the scanner
   * detects a stealth inflow and the relayer sweeps it. Should be cold storage
   * or a separate treasury EOA — NOT the agent EOA above.
   */
  SHROUDFI_TREASURY_WALLET: ethAddr.optional(),
  /**
   * Initial block for the scanner when no state cursor exists. Set near (but
   * before) when the receiving meta-address was first published, to avoid a
   * pointless multi-million block backfill.
   */
  SHROUDFI_SCAN_START_BLOCK: z.coerce.bigint().min(0n).default(0n),
  /**
   * Scanner poll cadence in milliseconds. Default 30s — Base's 2s block time
   * means we catch up within ~15 blocks per poll.
   */
  SHROUDFI_SCAN_INTERVAL_MS: z.coerce.number().int().min(2_000).max(600_000).default(30_000),
  /**
   * x402 facilitator URL. Defaults to PayAI's free-tier facilitator
   * (https://facilitator.payai.network) — see @shroud-fi/x402 PAYAI_FACILITATOR_URL.
   * Override with COINBASE_FACILITATOR_URL or a self-hosted facilitator.
   */
  X402_FACILITATOR_URL: z.string().url().default("https://facilitator.payai.network"),
  /**
   * Per-endpoint prices in raw USDC (1 USDC = 1_000_000 raw). Defaults pick a
   * conservative cost floor that covers SolRouter inference + a small margin.
   */
  X402_PRICE_AI_CHAT_RAW_USDC: z.coerce.bigint().min(1n).default(10_000n),
  /**
   * Optional per-model x402 price overrides for /ai/chat, as a JSON object
   * mapping model id → raw USDC price (1 USDC = 1_000_000). Models not listed
   * fall back to X402_PRICE_AI_CHAT_RAW_USDC. Empty object (default) ⇒ flat
   * pricing, identical to prior behaviour. Example:
   *   {"claude-opus-4-8":80000,"gpt-oss-20b":2000}
   */
  X402_AI_PRICE_MAP_JSON: z.string().default("{}"),
  X402_PRICE_CONTEXT_FULL_RAW_USDC: z.coerce.bigint().min(1n).default(5_000n),
  X402_PRICE_AGENT_OP_RAW_USDC: z.coerce.bigint().min(1n).default(5_000n),
  /**
   * Disable the background scanner (e.g. dev/staging environments that share
   * the same meta-address as prod — only one scanner should sweep). When
   * false (default), scanner starts iff X402_ENABLED=true AND all required
   * keys are present.
   */
  SHROUDFI_SCANNER_DISABLED: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof envSchema> & {
  transferFeeConfig: Record<string, z.infer<typeof feeConfigEntry>>;
};

function resolveAdminPk(data: z.infer<typeof envSchema>): string | undefined {
  return data.ADMIN_PRIVATE_KEY?.trim() || data.DEPLOYER_PRIVATE_KEY?.trim();
}

const envSchemaWithRefine = envSchema.superRefine((data, ctx) => {
  const cfg = parseFeeConfigJson(data.TRANSFER_FEE_CONFIG_JSON);
  let anyFee = false;
  for (const v of Object.values(cfg)) {
    const fixed = BigInt((v.fixed ?? "0").trim() === "" ? "0" : v.fixed!);
    if (fixed > 0n || (v.bps ?? 0) > 0) anyFee = true;
  }
  if (anyFee && !data.TRANSFER_FEE_LEDGER_ADDRESS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "TRANSFER_FEE_LEDGER_ADDRESS is required when TRANSFER_FEE_CONFIG_JSON has non-zero fees",
      path: ["TRANSFER_FEE_LEDGER_ADDRESS"],
    });
  }
});

export function loadEnv(): Env {
  const parsed = envSchemaWithRefine.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  const d = parsed.data;
  return {
    ...d,
    ADMIN_PRIVATE_KEY: resolveAdminPk(d),
    transferFeeConfig: parseFeeConfigJson(d.TRANSFER_FEE_CONFIG_JSON),
  } as Env;
}
