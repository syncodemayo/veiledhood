/**
 * Fetches the top 20 Uniswap V2 pairs by liquidity on Base via GeckoTerminal (no API key needed),
 * resolves token decimals/symbols on-chain, then rewrites
 * api/src/config/veilswapPairs.ts with both directions of each pair.
 *
 * Usage:
 *   npx tsx scripts/fetch-v2-pairs.ts
 *
 * Requires RPC_URL in .env (or env).
 */

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

const RPC_URL = process.env.RPC_URL;
if (!RPC_URL) throw new Error("RPC_URL not set");

const WETH  = "0x4200000000000000000000000000000000000006";
const USDC  = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const DAI   = "0x50c5725949a6f0c72e6c4a641f24049a917db0cb";
const CBBTC = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";

// Min liquidity filter — skip pools with < $50k to avoid meme-coin noise
const MIN_LIQUIDITY_USD = 50_000;
const TARGET_PAIRS = 20;

// These pairs are always included regardless of volume ranking.
// Ensures core liquid pairs (WETH↔USDC etc.) are never crowded out by meme coins.
type AnchorPair = { t0: string; t1: string };
const ANCHOR_PAIRS: AnchorPair[] = [
  { t0: WETH,  t1: USDC  },
  { t0: WETH,  t1: DAI   },
  { t0: USDC,  t1: DAI   },
  { t0: WETH,  t1: CBBTC },
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// GeckoTerminal: Uniswap V2 on Base
// DEX slug: uniswap-v2-base
// Docs: https://www.geckoterminal.com/dex-api
const GT_BASE = "https://api.geckoterminal.com/api/v2";
const GT_NETWORK = "base";
const GT_DEX = "uniswap-v2-base";

type GtPoolAttributes = {
  name: string;
  address: string;
  reserve_in_usd: string;
  volume_usd: { h24: string };
  base_token_price_usd: string;
};

type GtRelationship = {
  data: { id: string; type: string };
};

type GtPoolRelationships = {
  base_token: GtRelationship;
  quote_token: GtRelationship;
};

type GtPool = {
  id: string;
  attributes: GtPoolAttributes;
  relationships: GtPoolRelationships;
};

type GtResponse = {
  data: GtPool[];
};

type GtTokenAttributes = {
  address: string;
  symbol: string;
  decimals: number | null;
  name: string;
};

type GtTokenResponse = {
  data: {
    id: string;
    attributes: GtTokenAttributes;
  }[];
};

async function gtFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json;version=20230302" },
  });
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

async function fetchTopPools(minLiq: number, target: number): Promise<GtPool[]> {
  const pools: GtPool[] = [];
  let page = 1;

  while (pools.length < target) {
    const url = `${GT_BASE}/networks/${GT_NETWORK}/dexes/${GT_DEX}/pools?page=${page}`;
    const data = await gtFetch<GtResponse>(url);
    if (!data.data?.length) break;

    for (const pool of data.data) {
      const liq = Number(pool.attributes.reserve_in_usd ?? 0);
      const vol = Number(pool.attributes.volume_usd?.h24 ?? 0);
      if (liq >= minLiq || vol >= 10_000) {
        pools.push(pool);
      }
    }

    if (data.data.length < 20) break; // last page
    page++;
    // polite delay
    await new Promise((r) => setTimeout(r, 250));
  }

  // Sort by 24h volume desc, take top N
  return pools
    .sort((a, b) => Number(b.attributes.volume_usd?.h24 ?? 0) - Number(a.attributes.volume_usd?.h24 ?? 0))
    .slice(0, target);
}

// No longer used — we parse symbols from pool names and resolve decimals on-chain
// kept as a no-op to avoid removing the type
async function fetchTokenInfo(_tokenIds: string[]): Promise<Map<string, GtTokenAttributes>> {
  return new Map();
}

const SYMBOL_OVERRIDES: Record<string, string> = {
  [WETH]: "ETH",
};

async function resolveOnChain(
  provider: ethers.JsonRpcProvider,
  address: string,
  fallbackSymbol: string,
  fallbackDecimals: number,
): Promise<{ symbol: string; decimals: number }> {
  const override = SYMBOL_OVERRIDES[address.toLowerCase()];
  try {
    const contract = new ethers.Contract(address, ERC20_ABI, provider);
    const [symbol, decimals] = await Promise.all([
      contract.symbol() as Promise<string>,
      contract.decimals() as Promise<bigint>,
    ]);
    return { symbol: override ?? String(symbol), decimals: Number(decimals) };
  } catch {
    return { symbol: override ?? fallbackSymbol, decimals: fallbackDecimals };
  }
}

function checksum(addr: string): string {
  return ethers.getAddress(addr);
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function buildPath(tokenIn: string, tokenOut: string): string[] {
  const weth = checksum(WETH);
  // Resolve address(0) (native ETH) to WETH for the actual path
  const a = tokenIn === ZERO_ADDRESS ? weth : checksum(tokenIn);
  const b = tokenOut === ZERO_ADDRESS ? weth : checksum(tokenOut);
  if (a === weth || b === weth) return [a, b];
  return [a, weth, b];
}

/** When a token is WETH, return address(0) so the contract uses native ETH output. */
function toContractAddress(addr: string): string {
  return checksum(addr) === checksum(WETH) ? ZERO_ADDRESS : checksum(addr);
}

type VeilswapPairEntry = {
  tokenIn: string;
  tokenOut: string;
  symbolIn: string;
  symbolOut: string;
  decimalsIn: number;
  decimalsOut: number;
  path: string[];
};

function renderPairsFile(pairs: VeilswapPairEntry[]): string {
  const now = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `/** AUTO-GENERATED by scripts/fetch-v2-pairs.ts on ${now} — do not edit by hand. */`,
    `/** Re-run the script to refresh from GeckoTerminal (Uniswap V2 on Base). */`,
    ``,
    `export type VeilswapPair = {`,
    `  tokenIn: string;`,
    `  tokenOut: string;`,
    `  symbolIn: string;`,
    `  symbolOut: string;`,
    `  decimalsIn: number;`,
    `  decimalsOut: number;`,
    `  /** Uniswap V2 path (tokenIn → ... → tokenOut, using WETH for native ETH hops). */`,
    `  path: string[];`,
    `};`,
    ``,
    `export const VEILSWAP_PAIRS: VeilswapPair[] = [`,
  ];

  for (const p of pairs) {
    lines.push(`  {`);
    lines.push(`    tokenIn:    "${p.tokenIn}",`);
    lines.push(`    tokenOut:   "${p.tokenOut}",`);
    lines.push(`    symbolIn:   "${p.symbolIn}",`);
    lines.push(`    symbolOut:  "${p.symbolOut}",`);
    lines.push(`    decimalsIn:  ${p.decimalsIn},`);
    lines.push(`    decimalsOut: ${p.decimalsOut},`);
    lines.push(`    path: [${p.path.map((a) => `"${a}"`).join(", ")}],`);
    lines.push(`  },`);
  }

  lines.push(`];`, ``);
  return lines.join("\n");
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  console.log(`Fetching top ${TARGET_PAIRS} Uniswap V2 pools on Base from GeckoTerminal…`);
  const pools = await fetchTopPools(MIN_LIQUIDITY_USD, TARGET_PAIRS);
  console.log(`Got ${pools.length} pools`);

  if (pools.length === 0) throw new Error("No pools returned");

  // Extract token addresses from relationship IDs: "base_0xabc..." → "0xabc..."
  const tokenAddresses = new Set<string>();
  for (const pool of pools) {
    tokenAddresses.add(pool.relationships.base_token.data.id.replace(/^base_/, ""));
    tokenAddresses.add(pool.relationships.quote_token.data.id.replace(/^base_/, ""));
  }

  // Resolve symbol + decimals on-chain for all tokens (no external API needed)
  console.log(`Resolving ${tokenAddresses.size} token symbols/decimals on-chain…`);
  const tokenMap = new Map<string, { symbol: string; decimals: number }>();
  await Promise.all(
    Array.from(tokenAddresses).map(async (addr) => {
      const info = await resolveOnChain(provider, addr, addr.slice(0, 8), 18);
      tokenMap.set(addr.toLowerCase(), info);
    }),
  );

  // Resolve anchor tokens (may already be in tokenMap from pool results)
  const anchorAddrs = new Set([WETH, USDC, DAI, CBBTC].map((a) => a.toLowerCase()));
  for (const addr of anchorAddrs) {
    if (!tokenMap.has(addr)) {
      const info = await resolveOnChain(provider, addr, addr.slice(0, 8), 18);
      tokenMap.set(addr, info);
    }
  }

  const outputPairs: VeilswapPairEntry[] = [];

  // Prepend anchor pairs so they always appear first in the dropdown
  for (const { t0: raw0, t1: raw1 } of ANCHOR_PAIRS) {
    const t0 = checksum(raw0);
    const t1 = checksum(raw1);
    const tok0 = tokenMap.get(raw0.toLowerCase())!;
    const tok1 = tokenMap.get(raw1.toLowerCase())!;
    console.log(`  [anchor] ${tok0.symbol}/${tok1.symbol}`);
    outputPairs.push({
      tokenIn: toContractAddress(t0), tokenOut: toContractAddress(t1),
      symbolIn: tok0.symbol, symbolOut: tok1.symbol,
      decimalsIn: tok0.decimals, decimalsOut: tok1.decimals,
      path: buildPath(t0, t1),
    });
    outputPairs.push({
      tokenIn: toContractAddress(t1), tokenOut: toContractAddress(t0),
      symbolIn: tok1.symbol, symbolOut: tok0.symbol,
      decimalsIn: tok1.decimals, decimalsOut: tok0.decimals,
      path: buildPath(t1, t0),
    });
  }

  // Track which pairs are already covered to avoid duplicates from pool results
  const covered = new Set(outputPairs.map((p) => `${p.tokenIn}-${p.tokenOut}`));

  for (const pool of pools) {
    const t0raw = pool.relationships.base_token.data.id.replace(/^base_/, "");
    const t1raw = pool.relationships.quote_token.data.id.replace(/^base_/, "");

    const t0 = checksum(t0raw);
    const t1 = checksum(t1raw);
    const tok0 = tokenMap.get(t0raw.toLowerCase()) ?? { symbol: t0raw.slice(0, 8), decimals: 18 };
    const tok1 = tokenMap.get(t1raw.toLowerCase()) ?? { symbol: t1raw.slice(0, 8), decimals: 18 };

    const vol = Number(pool.attributes.volume_usd?.h24 ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
    const liq = Number(pool.attributes.reserve_in_usd ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
    console.log(`  ${tok0.symbol}/${tok1.symbol}  24h vol=$${vol}  liq=$${liq}`);

    const ct0 = toContractAddress(t0);
    const ct1 = toContractAddress(t1);
    const key01 = `${ct0}-${ct1}`;
    const key10 = `${ct1}-${ct0}`;
    if (!covered.has(key01)) {
      covered.add(key01);
      outputPairs.push({
        tokenIn: ct0, tokenOut: ct1,
        symbolIn: tok0.symbol, symbolOut: tok1.symbol,
        decimalsIn: tok0.decimals, decimalsOut: tok1.decimals,
        path: buildPath(t0, t1),
      });
    }
    if (!covered.has(key10)) {
      covered.add(key10);
      outputPairs.push({
        tokenIn: ct1, tokenOut: ct0,
        symbolIn: tok1.symbol, symbolOut: tok0.symbol,
        decimalsIn: tok1.decimals, decimalsOut: tok0.decimals,
        path: buildPath(t1, t0),
      });
    }
  }

  const outPath = path.resolve(__dirname, "../src/config/veilswapPairs.ts");
  await fs.writeFile(outPath, renderPairsFile(outputPairs), "utf8");
  console.log(`\nWrote ${outputPairs.length} pair entries → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
