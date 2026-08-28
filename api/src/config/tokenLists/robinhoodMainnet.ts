// Robinhood Chain mainnet (chainId 4663).

import type { TokenListEntry } from "../../util/tokenLists.js";

export const ROBINHOOD_MAINNET_TOKEN_LIST: ReadonlyArray<TokenListEntry> = [
  {
    // Official Global Dollar (USDG) — verified against docs.robinhood.com/chain/contracts,
    // which explicitly warns that other same-name "USDC"/"USDG" tokens on this chain are impersonators.
    address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    symbol: "USDG",
    name: "Global Dollar",
    decimals: 6,
    coingeckoId: "global-dollar",
  },
  {
    // Official WETH (docs.robinhood.com/chain/contracts). Used by
    // walletContextAggregator.nativeTokenLookup() purely to borrow price-feed
    // hints for pricing native ETH — this address itself is never dereferenced.
    // CoinGecko only (no pythSymbol) — Pyth Hermes returns 401 in this environment.
    address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    coingeckoId: "weth",
  },
];
