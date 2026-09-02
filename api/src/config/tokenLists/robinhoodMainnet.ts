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
  {
    // Verified on-chain: symbol()/name() match, address confirmed against the
    // VeilSwap NVDA/USDG V4 pool (see veilswapPairs.ts). No coingeckoId/pythSymbol
    // set — need to confirm the correct price-feed identifier for this
    // Robinhood-tokenized-stock product before pricing will work.
    address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",
    symbol: "NVDA",
    name: "NVIDIA • Robinhood Token",
    decimals: 18,
  },
  {
    address: "0x322f0929c4625ed5bad873c95208d54e1c003b2d",
    symbol: "TSLA",
    name: "Tesla • Robinhood Token",
    decimals: 18,
  },
  {
    address: "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea",
    symbol: "SPCX",
    name: "Space Exploration Technologies Corp. Class A Common Stock • Robinhood Token",
    decimals: 18,
  },
  {
    address: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9",
    symbol: "AAPL",
    name: "Apple • Robinhood Token",
    decimals: 18,
  },
  {
    address: "0x39dbed3a2bd333467115de45665cc57f813c4571",
    symbol: "PONS",
    name: "Pons",
    decimals: 18,
  },
  {
    address: "0x5e81213613b6b86eab4c6c50d718d34359459786",
    symbol: "TTWO",
    name: "Take-Two Interactive Software • Robinhood Token",
    decimals: 18,
  },
  {
    address: "0xb6a4be487fb569acacd83495e8ebbee10b583d34",
    symbol: "VEILEDHOOD",
    name: "Veiled Hood",
    decimals: 18,
  },
];
