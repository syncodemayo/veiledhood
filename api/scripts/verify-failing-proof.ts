/**
 * Decode the failing adminExecuteSwap calldata and verify the embedded
 * Merkle proof against the off-chain tree built from current SwapUserBalance.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import dotenv from "dotenv";
import mongoose from "mongoose";

import { SwapUserBalance } from "../src/models/SwapUserBalance.js";
import { buildSwapMerkleTree } from "../src/services/veilswapLeaves.js";
import { getProofForLeaf, verifyProofLocal } from "../src/services/merkleTree.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI!;
const CHAIN_ID = Number(process.env.CHAIN_ID ?? "8453");

// Failing calldata embedded for offline verification.
const FAILING_CALLDATA =
  "0xc0a07996000000000000000000000000a5fdb69f410ff432b2033b01c45c794e1f5949d8000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003839292df7608d03c7ec8f09bb256883dfa691d000000000000000000000000000000000000000000000000000000e8d4a5100000000000000000000000000000000000000000000000006b65b017dd6593703300000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000006a0cb9b50000000000000000000000000000000000000000000000000000000000000002000000000000000000000000420000000000000000000000000000000000000600000000000000000000000003839292df7608d03c7ec8f09bb256883dfa691d0000000000000000000000000000000000000000000000000000000000000002dc2a662a450537c51168ab0caa39d2c89b05c5ab1bb5e4a5fa774edc2771600b8cd833741ec3f5d4cabbae064bec70695180fdb08234198fdb846826d4a8f2d8";

const ADMIN_EXECUTE_SWAP_ABI = [
  "function adminExecuteSwap(address user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, address[] path, bytes32[] proof, uint256 deadline) external",
];

async function main() {
  const iface = new ethers.Interface(ADMIN_EXECUTE_SWAP_ABI);
  const decoded = iface.parseTransaction({ data: FAILING_CALLDATA });
  if (!decoded) throw new Error("Could not decode calldata");

  const [user, tokenIn, tokenOut, amountIn, amountOutMin, pathArr, proof, deadline] =
    decoded.args as unknown as [
      string,
      string,
      string,
      bigint,
      bigint,
      string[],
      string[],
      bigint,
    ];

  console.log("=== Decoded adminExecuteSwap ===");
  console.log("user        :", user);
  console.log("tokenIn     :", tokenIn);
  console.log("tokenOut    :", tokenOut);
  console.log("amountIn    :", amountIn.toString(), `(${ethers.formatUnits(amountIn, 18)} ETH)`);
  console.log("amountOutMin:", amountOutMin.toString());
  console.log("path        :", pathArr);
  console.log("proof       :", proof);
  console.log("deadline    :", deadline.toString());
  console.log("");

  await mongoose.connect(MONGODB_URI);
  const rows = await SwapUserBalance.find({ chainId: CHAIN_ID }).lean<
    { address: string; tokenAddress: string; totalAmount: string }[]
  >();
  const tree = await buildSwapMerkleTree(rows);

  console.log("=== Current off-chain tree ===");
  console.log("root :", tree.root);
  console.log("");

  // Compute what proof the current tree generates for (user, tokenIn, amountIn).
  let currentProof: string[] | null = null;
  try {
    currentProof = getProofForLeaf(tree, user, tokenIn, amountIn);
  } catch (err) {
    console.log("⚠️  Could not generate proof from current tree:", (err as Error).message);
  }
  if (currentProof) {
    console.log("=== Proof from current tree for the same leaf ===");
    console.log(currentProof);
    console.log("");

    const matchesSubmitted =
      currentProof.length === proof.length &&
      currentProof.every((h, i) => h.toLowerCase() === proof[i]!.toLowerCase());
    console.log(`Submitted proof matches current tree proof: ${matchesSubmitted ? "yes" : "NO"}`);
    if (!matchesSubmitted) {
      console.log(
        "→ The proof in the failing tx was generated from a DIFFERENT tree snapshot than the current one.",
      );
    }

    // Verify the submitted proof against the current root.
    const valid = verifyProofLocal(tree.root, user, tokenIn, amountIn, proof);
    console.log(`Submitted proof verifies under current root: ${valid ? "yes" : "NO"}`);
  }

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
