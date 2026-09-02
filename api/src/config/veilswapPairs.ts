/**
 * Uniswap V4 pool pairs on Robinhood Chain mainnet (chainId 4663).
 *
 * ETH ↔ USDG pool key read directly from the real on-chain `Initialize` event
 * log on PoolManager 0x8366a39CC670B4001A1121B8F6A443A643e40951 (topic1 =
 * poolId 0x54f7883914619af9105355bf83ed678bcf9f63560218ac61c9963b9503d0ba32,
 * via Blockscout getLogs) — fee=460 (0.046%), tickSpacing=9, no hooks.
 *
 * Robinhood-tokenized-stock pairs (NVDA/TSLA/SPCX/AAPL/PONS ↔ USDG) below were
 * NOT found via log scanning (many spam pools exist per token at bogus fee
 * tiers with negligible liquidity — see git history for the investigation).
 * AAPL and PONS PoolKeys were extracted from a real user swap transaction's
 * UniversalRouter calldata (V4_SWAP action) and independently verified by
 * recomputing keccak256(currency0, currency1, fee, tickSpacing, hooks) and
 * matching it against that transaction's PoolManager `Swap` event id:
 *   AAPL: tx 0x312c8a2fb36333ea047c7b2c725d828d3656101a813cacfdb7a2fc4e773c94e7
 *   PONS: tx 0xf99c859f6a973e37471d7f8f3c7c69e39f23c42f59fed4c9088f11aef43c375c
 * NVDA/TSLA/SPCX had no swap tx available, so instead were confirmed via
 * `extsload`-based liquidity comparison across all candidate pools found in
 * Initialize event logs (the real pool has ~40,000x+ the liquidity of every
 * other candidate for the same token).
 *
 * AAPL and PONS use Doppler-hook / dynamic-fee pools: `fee: 8388608` is
 * Uniswap V4's DYNAMIC_FEE_FLAG (0x800000) — the real per-swap fee is set at
 * runtime by the hook, not by this static value.
 *
 * VEIL is paired against *native ETH*, not the WETH ERC-20, despite being
 * requested as "VEIL/WETH". Tx 0xf0311f581e638810305a7be2f195c067c0c947020603e470668bc82bdf0bac7f
 * showed the real router path is VEIL → native ETH → "WTH what the hook?"
 * (a joke/test token) → WETH — i.e. there is no single-hop VEIL↔WETH pool.
 * Hop 1 (VEIL↔native ETH) *is* a real single-hop pool with substantial
 * extsload-verified liquidity, so that's what's wired in below; poolId
 * independently verified against that tx's PoolManager `Swap` event.
 *
 * Explicitly NOT added (do not add without a contract change):
 *   - GME: no direct GME↔USDG pool exists. Real liquidity requires a 2-hop
 *     route (USDG → unofficial duplicate "GME" token 0xc2362AfF... → official
 *     GME 0x1b0E319c...). VeilSwap.sol only supports single-hop swaps.
 *   - RDDT: liquidity lives on a separate Uniswap V3 deployment on this chain
 *     (pool 0xa8744E76aED23B05F0126335E7BD38f7935D19fe), not on the V4
 *     PoolManager this contract calls. VeilSwap.sol has no V3 swap path.
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

const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const TSLA = "0x322F0929c4625eD5bAd873c95208D54E1c003b2d";
const SPCX = "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa";
const AAPL = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9";
const PONS = "0x39dBED3a2bd333467115dE45665cC57F813C4571";
const TTWO = "0x5e81213613b6B86EaB4c6c50d718d34359459786";
const VEIL = "0xb6a4bE487FB569acacD83495E8EBbEe10B583d34";

/** Uniswap V4 DYNAMIC_FEE_FLAG (0x800000) — real fee is set at runtime by the pool's hook. */
const DYNAMIC_FEE_FLAG = 8388608;

const ETH_USDG_POOL_KEY: PoolKey = {
  currency0: ETH,
  currency1: USDG,
  fee: 460,
  tickSpacing: 9,
  hooks: NO_HOOK,
};

const NVDA_USDG_POOL_KEY: PoolKey = {
  currency0: USDG,
  currency1: NVDA,
  fee: 3000,
  tickSpacing: 60,
  hooks: NO_HOOK,
};

const TSLA_USDG_POOL_KEY: PoolKey = {
  currency0: TSLA,
  currency1: USDG,
  fee: 3000,
  tickSpacing: 60,
  hooks: NO_HOOK,
};

const SPCX_USDG_POOL_KEY: PoolKey = {
  currency0: SPCX,
  currency1: USDG,
  fee: 10000,
  tickSpacing: 200,
  hooks: NO_HOOK,
};

const AAPL_USDG_POOL_KEY: PoolKey = {
  currency0: USDG,
  currency1: AAPL,
  fee: DYNAMIC_FEE_FLAG,
  tickSpacing: 10,
  hooks: "0x70a9A88402989226847Ec122043CE5e7FF462080",
};

const PONS_USDG_POOL_KEY: PoolKey = {
  currency0: PONS,
  currency1: USDG,
  fee: 3000,
  tickSpacing: 60,
  hooks: NO_HOOK,
};

const TTWO_USDG_POOL_KEY: PoolKey = {
  currency0: TTWO,
  currency1: USDG,
  fee: 2500,
  tickSpacing: 25,
  hooks: NO_HOOK,
};

const VEIL_ETH_POOL_KEY: PoolKey = {
  currency0: ETH,
  currency1: VEIL,
  fee: 0,
  tickSpacing: 200,
  hooks: "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044",
};

export const VEILSWAP_PAIRS: VeilswapPair[] = [
  { tokenIn: ETH,  tokenOut: USDG, symbolIn: "ETH",  symbolOut: "USDG", decimalsIn: 18, decimalsOut: 6, poolKey: ETH_USDG_POOL_KEY },
  { tokenIn: USDG, tokenOut: ETH,  symbolIn: "USDG", symbolOut: "ETH",  decimalsIn: 6,  decimalsOut: 18, poolKey: ETH_USDG_POOL_KEY },

  { tokenIn: NVDA, tokenOut: USDG, symbolIn: "NVDA", symbolOut: "USDG", decimalsIn: 18, decimalsOut: 6, poolKey: NVDA_USDG_POOL_KEY },
  { tokenIn: USDG, tokenOut: NVDA, symbolIn: "USDG", symbolOut: "NVDA", decimalsIn: 6,  decimalsOut: 18, poolKey: NVDA_USDG_POOL_KEY },

  { tokenIn: TSLA, tokenOut: USDG, symbolIn: "TSLA", symbolOut: "USDG", decimalsIn: 18, decimalsOut: 6, poolKey: TSLA_USDG_POOL_KEY },
  { tokenIn: USDG, tokenOut: TSLA, symbolIn: "USDG", symbolOut: "TSLA", decimalsIn: 6,  decimalsOut: 18, poolKey: TSLA_USDG_POOL_KEY },

  { tokenIn: SPCX, tokenOut: USDG, symbolIn: "SPCX", symbolOut: "USDG", decimalsIn: 18, decimalsOut: 6, poolKey: SPCX_USDG_POOL_KEY },
  { tokenIn: USDG, tokenOut: SPCX, symbolIn: "USDG", symbolOut: "SPCX", decimalsIn: 6,  decimalsOut: 18, poolKey: SPCX_USDG_POOL_KEY },

  { tokenIn: AAPL, tokenOut: USDG, symbolIn: "AAPL", symbolOut: "USDG", decimalsIn: 18, decimalsOut: 6, poolKey: AAPL_USDG_POOL_KEY },
  { tokenIn: USDG, tokenOut: AAPL, symbolIn: "USDG", symbolOut: "AAPL", decimalsIn: 6,  decimalsOut: 18, poolKey: AAPL_USDG_POOL_KEY },

  { tokenIn: PONS, tokenOut: USDG, symbolIn: "PONS", symbolOut: "USDG", decimalsIn: 18, decimalsOut: 6, poolKey: PONS_USDG_POOL_KEY },
  { tokenIn: USDG, tokenOut: PONS, symbolIn: "USDG", symbolOut: "PONS", decimalsIn: 6,  decimalsOut: 18, poolKey: PONS_USDG_POOL_KEY },

  { tokenIn: TTWO, tokenOut: USDG, symbolIn: "TTWO", symbolOut: "USDG", decimalsIn: 18, decimalsOut: 6, poolKey: TTWO_USDG_POOL_KEY },
  { tokenIn: USDG, tokenOut: TTWO, symbolIn: "USDG", symbolOut: "TTWO", decimalsIn: 6,  decimalsOut: 18, poolKey: TTWO_USDG_POOL_KEY },

  { tokenIn: VEIL, tokenOut: ETH,  symbolIn: "VEILEDHOOD", symbolOut: "ETH",        decimalsIn: 18, decimalsOut: 18, poolKey: VEIL_ETH_POOL_KEY },
  { tokenIn: ETH,  tokenOut: VEIL, symbolIn: "ETH",        symbolOut: "VEILEDHOOD", decimalsIn: 18, decimalsOut: 18, poolKey: VEIL_ETH_POOL_KEY },
];
