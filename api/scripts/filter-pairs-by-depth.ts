/**
 * Probes every pair in `api/src/config/veilswapPairs.ts` against the real
 * Uniswap V4 PoolManager on Base to confirm which pools are initialised and
 * what sqrtPriceX96 they have.  Replaces the old V2-router depth script.
 *
 * Usage:
 *   npx tsx scripts/filter-pairs-by-depth.ts           # dry-run table
 *   npx tsx scripts/filter-pairs-by-depth.ts --write   # rewrite veilswapPairs.ts
 *
 * Requires: RPC_URL in .env.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import dotenv from "dotenv";

import { VEILSWAP_PAIRS, type VeilswapPair, type PoolKey } from "../src/config/veilswapPairs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

const POOL_MANAGER = "0x498581ff718922c3f8e6a244956af099b2652b2b";
const POOLS_SLOT   = 6n;

function poolId(key: PoolKey): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint24", "int24", "address"],
    [ethers.getAddress(key.currency0.toLowerCase()), ethers.getAddress(key.currency1.toLowerCase()), key.fee, key.tickSpacing, ethers.getAddress(key.hooks.toLowerCase())]
  );
  return ethers.keccak256(encoded);
}

async function readSqrtPrice(provider: ethers.JsonRpcProvider, key: PoolKey): Promise<bigint> {
  const pid = poolId(key);
  const stateSlot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32"],
      [pid, ethers.zeroPadValue(ethers.toBeHex(POOLS_SLOT), 32)]
    )
  );
  const raw = await provider.getStorage(POOL_MANAGER, stateSlot);
  return BigInt(raw) & ((1n << 160n) - 1n);
}

async function main(): Promise<void> {
  const rpc = process.env.RPC_URL?.trim();
  if (!rpc) throw new Error("RPC_URL not set");

  const provider = new ethers.JsonRpcProvider(rpc);
  const block = await provider.getBlockNumber();
  console.log(`\nV4 pool check · Base mainnet · block ${block.toLocaleString()}\n`);

  const seenPairs = new Set<string>();
  const LINE = "─".repeat(80);
  console.log(LINE);
  console.log(`  ${"Pair".padEnd(18)} ${"Fee".padEnd(8)} ${"tickSpacing".padEnd(13)} Status`);
  console.log(LINE);

  for (const p of VEILSWAP_PAIRS) {
    const pairKey = `${p.tokenIn.toLowerCase()}-${p.tokenOut.toLowerCase()}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    const sqrtP = await readSqrtPrice(provider, p.poolKey);
    const status = sqrtP > 0n ? `✓ sqrtP=${sqrtP.toString().slice(0, 12)}…` : "✗ not initialised";
    const pair = `${p.symbolIn}→${p.symbolOut}`;
    console.log(`  ${pair.padEnd(18)} ${String(p.poolKey.fee).padEnd(8)} ${String(p.poolKey.tickSpacing).padEnd(13)} ${status}`);
  }
  console.log(LINE + "\n");
}

main().catch((err) => { console.error(err); process.exit(1); });
