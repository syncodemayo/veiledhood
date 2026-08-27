import { canonicalLedgerCurrencyKey } from "./ledgerCurrency.js";
import type { Env } from "../config/env.js";

export type ResolvedTransferFeeConfig = {
  fixed: bigint;
  bps: number;
  treasuryLedgerAddress: string | null;
};

function feeKeyForCurrency(currency: string): string {
  return canonicalLedgerCurrencyKey(currency);
}

/**
 * Per-token fees from `env.transferFeeConfig` (from `TRANSFER_FEE_CONFIG_JSON`).
 * Keys: `native` or lowercase `0x` token address.
 */
export function getTransferFeeConfigForCurrency(
  env: Env,
  currency: string
): ResolvedTransferFeeConfig {
  const key = feeKeyForCurrency(currency);
  const cfg = env.transferFeeConfig[key] ?? { fixed: "0", bps: 0 };
  const fixedRaw = (cfg.fixed ?? "0").trim();
  const fixed = /^\d+$/.test(fixedRaw) ? BigInt(fixedRaw) : 0n;
  return {
    fixed,
    bps: cfg.bps ?? 0,
    treasuryLedgerAddress: env.TRANSFER_FEE_LEDGER_ADDRESS ?? null,
  };
}
