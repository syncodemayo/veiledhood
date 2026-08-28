export type VaultAssetId = "eth" | "usdg";

export interface VaultAsset {
  id: VaultAssetId;
  symbol: string;
  decimals: number;
  /** ERC-20 contract address, or null for native ETH. */
  tokenAddress: string | null;
  /** Ledger currency key used by the API (`native`, or lowercase token address). */
  currencyKey: string;
}

// Robinhood Chain mainnet's official stablecoin (Global Dollar) — verified against
// docs.robinhood.com/chain/contracts and the Blockscout explorer directly.
const USDG_ADDRESS = (import.meta.env.VITE_USDG_ADDRESS ?? "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168").toLowerCase();

export const VAULT_ASSETS: VaultAsset[] = [
  { id: "eth", symbol: "ETH", decimals: 18, tokenAddress: null, currencyKey: "native" },
  { id: "usdg", symbol: "USDG", decimals: 6, tokenAddress: USDG_ADDRESS, currencyKey: USDG_ADDRESS },
];

export function getVaultAsset(id: VaultAssetId): VaultAsset {
  return VAULT_ASSETS.find((a) => a.id === id)!;
}

/** Resolve a ledger currency key (`native`, or a lowercase token address) to its known asset, if any. */
export function resolveCurrency(currencyKey: string): VaultAsset | undefined {
  return VAULT_ASSETS.find((a) => a.currencyKey === currencyKey.toLowerCase());
}
