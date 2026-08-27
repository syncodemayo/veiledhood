// Robinhood Chain Testnet (chainId 46630). No canonical ERC-20 token list exists yet on this
// testnet — add entries here (e.g. the deployed MockUSDC address) as contracts go live.

import type { TokenListEntry } from "../../util/tokenLists.js";

export const ROBINHOOD_TESTNET_TOKEN_LIST: ReadonlyArray<TokenListEntry> = [
  {
    address: "0xa25a286d870167ccb2ead984d177486e3f8f2df0",
    symbol: "USDC",
    name: "Mock USDC",
    decimals: 6,
    // Test-only mock, pegged at exactly $1 — not a real token, no live price feed.
    fixedUsd: 1,
  },
  {
    // Not a real deployed contract — walletContextAggregator.nativeTokenLookup()
    // looks up a "WETH" entry by symbol purely to borrow its price-feed hints
    // for pricing native ETH. This address is never called or dereferenced.
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    name: "Wrapped Ether (price-feed placeholder)",
    decimals: 18,
    coingeckoId: "weth",
    pythSymbol: "Crypto.ETH/USD",
  },
];
