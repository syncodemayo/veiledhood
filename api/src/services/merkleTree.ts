import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { ethers } from "ethers";

/** One positive ledger row → one tree leaf `(user, token, balance)` per Veiledhood.sol. */
export type MerkleLeafInput = {
  user: string;
  /** `0x000…000` for native ETH (must match on-chain `address(0)`). */
  token: string;
  balance: bigint;
};

export type VeiledhoodMerkleTree = StandardMerkleTree<[string, string, bigint]>;

const LEAF_TYPES = ["address", "address", "uint256"] as const;

/**
 * Solidity `Veiledhood._leaf`: keccak256(bytes.concat(keccak256(abi.encode(user, token, balance)))).
 * Matches `@openzeppelin/merkle-tree` StandardMerkleTree leaf hash for the same tuple encoding.
 */
export function solidityLeafHash(
  user: string,
  token: string,
  balance: bigint
): string {
  const enc = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint256"],
    [ethers.getAddress(user), ethers.getAddress(token), balance]
  );
  return ethers.keccak256(
    ethers.concat([ethers.keccak256(enc)])
  );
}

/**
 * Build a standard Merkle tree from all positive-balance ledger leaves.
 * Leaves are sorted internally by the library (standard-v1).
 */
export function buildMerkleTree(leaves: MerkleLeafInput[]): VeiledhoodMerkleTree {
  if (leaves.length === 0) {
    throw new Error("Cannot build Merkle tree with zero leaves");
  }
  const values: [string, string, bigint][] = leaves.map((l) => [
    ethers.getAddress(l.user),
    ethers.getAddress(l.token),
    l.balance,
  ]);
  return StandardMerkleTree.of(values, [...LEAF_TYPES]);
}

/** Proof elements as `bytes32` hex strings for `MerkleProof.verifyCalldata`. */
export function getProofForLeaf(
  tree: VeiledhoodMerkleTree,
  user: string,
  token: string,
  balance: bigint
): string[] {
  const leaf: [string, string, bigint] = [
    ethers.getAddress(user),
    ethers.getAddress(token),
    balance,
  ];
  return [...tree.getProof(leaf)];
}

export function verifyProofLocal(
  root: string,
  user: string,
  token: string,
  balance: bigint,
  proof: string[]
): boolean {
  const leaf: [string, string, bigint] = [
    ethers.getAddress(user),
    ethers.getAddress(token),
    balance,
  ];
  return StandardMerkleTree.verify(root, [...LEAF_TYPES], leaf, proof);
}
