import { ethers } from "ethers";
import type { ISwapUserBalance } from "../models/SwapUserBalance.js";
import { buildMerkleTree, getProofForLeaf, type MerkleLeafInput, type VeiledhoodMerkleTree } from "./merkleTree.js";

/** Map SwapUserBalance rows to `(user, token, balance)` Merkle leaves (positive balances only). */
export function swapUserBalancesToMerkleLeaves(
  rows: Pick<ISwapUserBalance, "address" | "tokenAddress" | "totalAmount">[]
): MerkleLeafInput[] {
  const leaves: MerkleLeafInput[] = [];
  for (const row of rows) {
    const raw = (row.totalAmount ?? "").trim();
    if (!/^\d+$/.test(raw)) continue;
    const balance = BigInt(raw);
    if (balance <= 0n) continue;
    leaves.push({
      user: ethers.getAddress(row.address),
      token: ethers.getAddress(row.tokenAddress),
      balance,
    });
  }
  return leaves;
}

export async function buildSwapMerkleTree(
  rows: Pick<ISwapUserBalance, "address" | "tokenAddress" | "totalAmount">[]
): Promise<VeiledhoodMerkleTree> {
  const leaves = swapUserBalancesToMerkleLeaves(rows);
  if (leaves.length === 0) {
    throw new Error("Cannot build VeilSwap Merkle tree: no positive balance rows");
  }
  return buildMerkleTree(leaves);
}

export { getProofForLeaf };
