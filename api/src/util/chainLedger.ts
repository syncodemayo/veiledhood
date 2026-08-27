import { normalizeLedgerCurrency } from "./ledgerCurrency.js";

export const DEFAULT_BASE_CHAIN_ID = 46630;
export const DEFAULT_ETH_CHAIN_ID = 1;

export function buildAssetKey(chainId: number, currency: string): string {
  return `${chainId}:${normalizeLedgerCurrency(currency)}`;
}

