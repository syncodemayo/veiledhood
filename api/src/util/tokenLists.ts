import { ROBINHOOD_TESTNET_TOKEN_LIST } from "../config/tokenLists/robinhoodTestnet.js";

export interface TokenListEntry {
  /** Lowercase 0x-prefixed contract address. */
  readonly address: string;
  /** On-chain ERC-20 symbol. */
  readonly symbol: string;
  /** Display name. */
  readonly name: string;
  /** ERC-20 decimals (used for balance formatting). */
  readonly decimals: number;
  /** CoinGecko price feed slug (fallback). Omit only for tokens with no public market. */
  readonly coingeckoId?: string;
  /** Pyth feed symbol (primary). Omit if Pyth has no feed for this asset. */
  readonly pythSymbol?: string;
  /** Hardcoded USD price — skips Pyth/CoinGecko entirely. For test-only pegged mocks (e.g. MockUSDC). */
  readonly fixedUsd?: number;
}

const ROBINHOOD_TESTNET_CHAIN_ID = 46630;

const LIST_BY_CHAIN: Record<number, ReadonlyArray<TokenListEntry>> = {
  [ROBINHOOD_TESTNET_CHAIN_ID]: ROBINHOOD_TESTNET_TOKEN_LIST,
};

const SUPPORTED_CHAIN_IDS = Object.keys(LIST_BY_CHAIN).map(Number);

/**
 * Get the full token list for a chain. Returns an empty array (not throws)
 * for unsupported chains so callers can degrade gracefully.
 */
export function getTokenList(chainId: number): ReadonlyArray<TokenListEntry> {
  return LIST_BY_CHAIN[chainId] ?? [];
}

/**
 * Look up a single token by address (case-insensitive) on a given chain.
 */
export function getTokenByAddress(
  chainId: number,
  address: string,
): TokenListEntry | undefined {
  const lc = address.toLowerCase();
  return getTokenList(chainId).find((t) => t.address === lc);
}

/**
 * Look up a single token by symbol (case-insensitive) on a given chain.
 * Returns the first match if duplicates exist.
 */
export function getTokenBySymbol(
  chainId: number,
  symbol: string,
): TokenListEntry | undefined {
  const uc = symbol.toUpperCase();
  return getTokenList(chainId).find((t) => t.symbol.toUpperCase() === uc);
}

export function isSupportedChain(chainId: number): boolean {
  return chainId in LIST_BY_CHAIN;
}

export function supportedChainIds(): ReadonlyArray<number> {
  return SUPPORTED_CHAIN_IDS;
}
