/**
 * Uniswap V4 pool pairs on Robinhood Chain mainnet (chainId 4663).
 *
 * ETH ↔ USDG pool key read directly from the real on-chain `Initialize` event
 * log on PoolManager 0x8366a39CC670B4001A1121B8F6A443A643e40951 (topic1 =
 * poolId 0x54f7883914619af9105355bf83ed678bcf9f63560218ac61c9963b9503d0ba32,
 * via Blockscout getLogs) — fee=460 (0.046%), tickSpacing=9, no hooks.
 */

export type PoolKey = {
  currency0: string;  // numerically smaller address (native ETH = 0x0000…0000)
  currency1: string;  // numerically larger address
  fee: number;        // V4 units: 1_000_000 = 100% (100=0.01%, 500=0.05%, 3000=0.3%, 10000=1%)
  tickSpacing: number;
  hooks: string;      // 0x0000…0000 for standard (no-hook) pools
};

export type VeilswapPair = {
  tokenIn: string;
  tokenOut: string;
  symbolIn: string;
  symbolOut: string;
  decimalsIn: number;
  decimalsOut: number;
  poolKey: PoolKey;
};

const NO_HOOK = "0x0000000000000000000000000000000000000000";
const ETH     = "0x0000000000000000000000000000000000000000"; // native ETH
const USDG    = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

const ETH_USDG_POOL_KEY: PoolKey = {
  currency0: ETH,
  currency1: USDG,
  fee: 460,
  tickSpacing: 9,
  hooks: NO_HOOK,
};

export const VEILSWAP_PAIRS: VeilswapPair[] = [
  { tokenIn: ETH,  tokenOut: USDG, symbolIn: "ETH",  symbolOut: "USDG", decimalsIn: 18, decimalsOut: 6, poolKey: ETH_USDG_POOL_KEY },
  { tokenIn: USDG, tokenOut: ETH,  symbolIn: "USDG", symbolOut: "ETH",  decimalsIn: 6,  decimalsOut: 18, poolKey: ETH_USDG_POOL_KEY },
];
