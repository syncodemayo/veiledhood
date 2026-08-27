/**
 * Curated Uniswap V4 pool pairs on Base mainnet.
 * Sourced from GeckoTerminal top pools — only non-hook pools (known fee tier)
 * with TVL > $1M are included. Hook-based (dynamic-fee) pools are excluded
 * because their fee value is unknown at quote time.
 *
 * WETH (0x4200…0006) pairs are also excluded — VeilSwap handles native ETH
 * only (address(0)); WETH would require separate wrap/unwrap logic.
 *
 * Re-run `scripts/filter-pairs-by-depth.ts` after updating to verify every
 * pool is still initialised on-chain.
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

const NO_HOOK  = "0x0000000000000000000000000000000000000000";
const ETH      = "0x0000000000000000000000000000000000000000"; // native ETH
const WETH     = "0x4200000000000000000000000000000000000006";
const USDC    = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const cbBTC   = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const POD     = "0xEd664536023d8e4B1640c394777D34ABaFF1Df8f";
const PITCH   = "0xeAe13ea73bEC936664a51734c8c01Ec7C3B0699C";
const VVV     = "0xACFE6019Ed1A7dc6F7B508C02d1B04eC88CC21bF";
const KTA     = "0xc0634090f2fe6C6D75E61bE2b949464ABB498973";
const OTHQ    = "0x0b2558bDBc7FFec0F327fb3579c23dAbD1699706";
const BEAN    = "0x5C72992b83E74c4d5200a8E8920fb946214a5a5D";
const CGN     = "0x2E6C4bD1c947e195645d2B920B827498CfaA6766";
const GITLAWB = "0x5F980DCfc4C0FA3911554cF5aB288eD0EB13dba3";
const VEILEDHOOD = "0xd13ba0d625c04b8364de5e15e58bf2ebdda8dba3";

/** V4 standard tick-spacing per fee tier. */
const TICK_SPACING: Record<number, number> = {
  100:   1,
  500:   10,
  3000:  60,
  10000: 200,
};

/** currency0 < currency1 numerically; native ETH (0x0000…) is always currency0. */
function pk(tokenA: string, tokenB: string, fee: number): PoolKey {
  const [c0, c1] = tokenA.toLowerCase() < tokenB.toLowerCase()
    ? [tokenA, tokenB] : [tokenB, tokenA];
  return { currency0: c0, currency1: c1, fee, tickSpacing: TICK_SPACING[fee]!, hooks: NO_HOOK };
}

export const VEILSWAP_PAIRS: VeilswapPair[] = [
  // ── ETH ↔ USDC  ·  fee=3000 (0.3%)  ·  TVL ~$5.3M ─────────────────────────
  { tokenIn: ETH,  tokenOut: USDC, symbolIn: "ETH",  symbolOut: "USDC", decimalsIn: 18, decimalsOut: 6,  poolKey: pk(ETH, USDC, 3000) },
  { tokenIn: USDC, tokenOut: ETH,  symbolIn: "USDC", symbolOut: "ETH",  decimalsIn: 6,  decimalsOut: 18, poolKey: pk(USDC, ETH,  3000) },

  // ── cbBTC ↔ USDC  ·  fee=500 (0.05%)  ·  TVL ~$5.1M ─────────────────────────
  { tokenIn: cbBTC, tokenOut: USDC,  symbolIn: "cbBTC", symbolOut: "USDC",  decimalsIn: 8, decimalsOut: 6, poolKey: pk(cbBTC, USDC,  500) },
  { tokenIn: USDC,  tokenOut: cbBTC, symbolIn: "USDC",  symbolOut: "cbBTC", decimalsIn: 6, decimalsOut: 8, poolKey: pk(USDC,  cbBTC, 500) },

  // ── POD ↔ ETH  ·  fee=10000 (1%)  ·  TVL ~$3.6M ──────────────────────────────
  { tokenIn: POD, tokenOut: ETH, symbolIn: "POD", symbolOut: "ETH", decimalsIn: 18, decimalsOut: 18, poolKey: pk(POD, ETH, 10000) },
  { tokenIn: ETH, tokenOut: POD, symbolIn: "ETH", symbolOut: "POD", decimalsIn: 18, decimalsOut: 18, poolKey: pk(ETH, POD, 10000) },

  // ── PITCH ↔ ETH  ·  fee=10000 (1%)  ·  TVL ~$1.6M ────────────────────────────
  { tokenIn: PITCH, tokenOut: ETH,   symbolIn: "PITCH", symbolOut: "ETH",   decimalsIn: 18, decimalsOut: 18, poolKey: pk(PITCH, ETH,   10000) },
  { tokenIn: ETH,   tokenOut: PITCH, symbolIn: "ETH",   symbolOut: "PITCH", decimalsIn: 18, decimalsOut: 18, poolKey: pk(ETH,   PITCH, 10000) },

  // ── VVV ↔ USDC  ·  fee=3000 (0.3%)  ·  TVL ~$1.1M ────────────────────────────
  { tokenIn: VVV,  tokenOut: USDC, symbolIn: "VVV",  symbolOut: "USDC", decimalsIn: 18, decimalsOut: 6, poolKey: pk(VVV,  USDC, 3000) },
  { tokenIn: USDC, tokenOut: VVV,  symbolIn: "USDC", symbolOut: "VVV",  decimalsIn: 6,  decimalsOut: 18, poolKey: pk(USDC, VVV,  3000) },

  // ── KTA ↔ ETH  ·  fee=10000 (1%)  ·  TVL ~$1.3M ─────────────────────────────
  { tokenIn: KTA, tokenOut: ETH,  symbolIn: "KTA", symbolOut: "ETH",  decimalsIn: 18, decimalsOut: 18, poolKey: pk(KTA, ETH,  10000) },
  { tokenIn: ETH, tokenOut: KTA,  symbolIn: "ETH", symbolOut: "KTA",  decimalsIn: 18, decimalsOut: 18, poolKey: pk(ETH, KTA,  10000) },

  // ── KTA ↔ USDC  ·  fee=10000 (1%)  ·  TVL ~$715K ────────────────────────────
  { tokenIn: KTA,  tokenOut: USDC, symbolIn: "KTA",  symbolOut: "USDC", decimalsIn: 18, decimalsOut: 6, poolKey: pk(KTA,  USDC, 10000) },
  { tokenIn: USDC, tokenOut: KTA,  symbolIn: "USDC", symbolOut: "KTA",  decimalsIn: 6,  decimalsOut: 18, poolKey: pk(USDC, KTA,  10000) },

  // ── OTHQ ↔ USDC  ·  fee=100 (0.01%)  ·  TVL ~$594K ──────────────────────────
  { tokenIn: OTHQ, tokenOut: USDC, symbolIn: "OTHQ", symbolOut: "USDC", decimalsIn: 18, decimalsOut: 6, poolKey: pk(OTHQ, USDC, 100) },
  { tokenIn: USDC, tokenOut: OTHQ, symbolIn: "USDC", symbolOut: "OTHQ", decimalsIn: 6,  decimalsOut: 18, poolKey: pk(USDC, OTHQ, 100) },

  // ── BEAN ↔ ETH  ·  fee=10000 (1%)  ·  TVL ~$345K ────────────────────────────
  { tokenIn: BEAN, tokenOut: ETH,  symbolIn: "BEAN", symbolOut: "ETH",  decimalsIn: 18, decimalsOut: 18, poolKey: pk(BEAN, ETH,  10000) },
  { tokenIn: ETH,  tokenOut: BEAN, symbolIn: "ETH",  symbolOut: "BEAN", decimalsIn: 18, decimalsOut: 18, poolKey: pk(ETH,  BEAN, 10000) },

  // ── CGN ↔ USDC  ·  fee=100 (0.01%)  ·  TVL ~$238K ───────────────────────────
  { tokenIn: CGN,  tokenOut: USDC, symbolIn: "CGN",  symbolOut: "USDC", decimalsIn: 18, decimalsOut: 6, poolKey: pk(CGN,  USDC, 100) },
  { tokenIn: USDC, tokenOut: CGN,  symbolIn: "USDC", symbolOut: "CGN",  decimalsIn: 6,  decimalsOut: 18, poolKey: pk(USDC, CGN,  100) },

  // ── VVV ↔ cbBTC  ·  fee=3000 (0.3%)  ·  TVL ~$144K ──────────────────────────
  { tokenIn: VVV,   tokenOut: cbBTC, symbolIn: "VVV",   symbolOut: "cbBTC", decimalsIn: 18, decimalsOut: 8, poolKey: pk(VVV,   cbBTC, 3000) },
  { tokenIn: cbBTC, tokenOut: VVV,   symbolIn: "cbBTC", symbolOut: "VVV",   decimalsIn: 8,  decimalsOut: 18, poolKey: pk(cbBTC, VVV,   3000) },

  // ── GITLAWB ↔ ETH  ·  fee=10000 (1%)  ·  TVL ~$100K ─────────────────────────
  { tokenIn: GITLAWB, tokenOut: ETH,     symbolIn: "GITLAWB", symbolOut: "ETH",     decimalsIn: 18, decimalsOut: 18, poolKey: pk(GITLAWB, ETH,     10000) },
  { tokenIn: ETH,     tokenOut: GITLAWB, symbolIn: "ETH",     symbolOut: "GITLAWB", decimalsIn: 18, decimalsOut: 18, poolKey: pk(ETH,     GITLAWB, 10000) },

  // ── GITLAWB ↔ USDC  ·  fee=3000 (0.3%)  ·  TVL ~$98K ────────────────────────
  { tokenIn: GITLAWB, tokenOut: USDC,    symbolIn: "GITLAWB", symbolOut: "USDC",    decimalsIn: 18, decimalsOut: 6, poolKey: pk(GITLAWB, USDC,    3000) },
  { tokenIn: USDC,    tokenOut: GITLAWB, symbolIn: "USDC",    symbolOut: "GITLAWB", decimalsIn: 6,  decimalsOut: 18, poolKey: pk(USDC,    GITLAWB, 3000) },

  // ── VEILEDHOOD ↔ WETH  ·  fee=dynamic (0x800000)  ·  hooks=0xbdf9…  ·  TVL ~$152K
  // NB: dynamic-fee hook pool; WETH (not native ETH) is the paired asset.
  { tokenIn: VEILEDHOOD, tokenOut: WETH, symbolIn: "VEILEDHOOD", symbolOut: "WETH", decimalsIn: 18, decimalsOut: 18,
    poolKey: { currency0: WETH, currency1: VEILEDHOOD, fee: 0x800000, tickSpacing: 200, hooks: "0xbdf938149ac6a781f94faa0ed45e6a0e984c6544" } },
  { tokenIn: WETH, tokenOut: VEILEDHOOD, symbolIn: "WETH", symbolOut: "VEILEDHOOD", decimalsIn: 18, decimalsOut: 18,
    poolKey: { currency0: WETH, currency1: VEILEDHOOD, fee: 0x800000, tickSpacing: 200, hooks: "0xbdf938149ac6a781f94faa0ed45e6a0e984c6544" } },
];
