/**
 * Diagnose VeilSwap Merkle root sync.
 *
 * Reads every SwapUserBalance row, builds the off-chain tree, fetches the
 * on-chain root, and prints both. If they differ — and you pass `--fix` — it
 * sends `updateMerkleRoot(offchainRoot)` to align them.
 *
 * Usage:
 *   npx tsx scripts/diagnose-merkle-root.ts            # read-only
 *   npx tsx scripts/diagnose-merkle-root.ts --fix      # update on-chain root
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { SwapUserBalance } from "../src/models/SwapUserBalance.js";
import { buildSwapMerkleTree } from "../src/services/veilswapLeaves.js";
import { VEILSWAP_ABI } from "../src/abi/veilSwap.js";
import { sendDeployerContractTx } from "../src/services/deployerTxQueue.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

const FIX = process.argv.includes("--fix");

const RPC_URL = process.env.RPC_URL;
const VAULT = process.env.VEILSWAP_ADDRESS;
const ADMIN_PK = process.env.ADMIN_PRIVATE_KEY;
const CHAIN_ID = Number(process.env.CHAIN_ID ?? "8453");
const MONGODB_URI = process.env.MONGODB_URI;

if (!RPC_URL) throw new Error("RPC_URL not set");
if (!VAULT) throw new Error("VEILSWAP_ADDRESS not set");
if (!MONGODB_URI) throw new Error("MONGODB_URI not set");
if (FIX && !ADMIN_PK) throw new Error("ADMIN_PRIVATE_KEY required for --fix");

async function main() {
  await mongoose.connect(MONGODB_URI!);

  const rows = await SwapUserBalance.find({ chainId: CHAIN_ID }).lean<
    { address: string; tokenAddress: string; totalAmount: string }[]
  >();

  console.log(`SwapUserBalance rows (chainId=${CHAIN_ID}): ${rows.length}`);
  const positive = rows.filter((r) => {
    const a = (r.totalAmount ?? "").trim();
    return /^\d+$/.test(a) && BigInt(a) > 0n;
  });
  console.log(`Positive-balance rows (Merkle leaves): ${positive.length}\n`);
  for (const r of positive) {
    console.log(`  ${r.address}  tok=${r.tokenAddress}  amt=${r.totalAmount}`);
  }
  console.log("");

  if (positive.length === 0) {
    console.log("No positive balances — tree cannot be built.");
    await mongoose.disconnect();
    return;
  }

  const tree = await buildSwapMerkleTree(rows);
  const offRoot = tree.root.toLowerCase();
  console.log(`Off-chain Merkle root: ${offRoot}`);

  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, {
    staticNetwork: true,
  });
  const contract = new ethers.Contract(VAULT!, VEILSWAP_ABI, provider);
  const onRoot = ((await contract.getMerkleRoot()) as string).toLowerCase();
  console.log(`On-chain  Merkle root: ${onRoot}`);

  if (offRoot === onRoot) {
    console.log("\n✓ Roots match. adminExecuteSwap should validate proofs cleanly.");
    await mongoose.disconnect();
    return;
  }

  console.log("\n✗ MISMATCH — on-chain root does not include current ledger state.");
  console.log("  Proofs built from the off-chain tree WILL revert with InvalidMerkleProof.");

  if (!FIX) {
    console.log("\nRe-run with --fix to send updateMerkleRoot(offchainRoot).");
    await mongoose.disconnect();
    return;
  }

  console.log("\nSending updateMerkleRoot(offchainRoot)…");
  const receipt = await sendDeployerContractTx({
    rpcUrl: RPC_URL!,
    privateKey: ADMIN_PK!,
    staticChainId: CHAIN_ID,
    send: async (wallet, nonce) => {
      const c = new ethers.Contract(VAULT!, VEILSWAP_ABI, wallet);
      return c.updateMerkleRoot(tree.root, { nonce });
    },
  });
  console.log(`Mined: ${receipt.hash}`);

  const after = ((await contract.getMerkleRoot()) as string).toLowerCase();
  console.log(`On-chain root now: ${after}`);
  console.log(
    after === offRoot ? "✓ Roots synced." : "✗ Still mismatched — investigate further.",
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
