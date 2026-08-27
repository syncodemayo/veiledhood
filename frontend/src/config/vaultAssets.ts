export type VaultAssetId = "eth" | "usdc";

export interface VaultAsset {
  id: VaultAssetId;
  symbol: string;
  decimals: number;
  /** ERC-20 contract address, or null for native ETH. */
  tokenAddress: string | null;
  /** Ledger currency key used by the API (`native`, or lowercase token address). */
  currencyKey: string;
}

const MOCK_USDC_ADDRESS = (import.meta.env.VITE_MOCK_USDC_ADDRESS ?? "0xA25A286d870167cCB2EAD984D177486e3f8F2DF0").toLowerCase();

export const VAULT_ASSETS: VaultAsset[] = [
  { id: "eth", symbol: "ETH", decimals: 18, tokenAddress: null, currencyKey: "native" },
  { id: "usdc", symbol: "USDC", decimals: 6, tokenAddress: MOCK_USDC_ADDRESS, currencyKey: MOCK_USDC_ADDRESS },
];

export function getVaultAsset(id: VaultAssetId): VaultAsset {
  return VAULT_ASSETS.find((a) => a.id === id)!;
}

/** Resolve a ledger currency key (`native`, or a lowercase token address) to its known asset, if any. */
export function resolveCurrency(currencyKey: string): VaultAsset | undefined {
  return VAULT_ASSETS.find((a) => a.currencyKey === currencyKey.toLowerCase());
}
