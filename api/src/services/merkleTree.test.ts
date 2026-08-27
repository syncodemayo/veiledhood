import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ethers } from "ethers";
import {
  buildMerkleTree,
  getProofForLeaf,
  solidityLeafHash,
  verifyProofLocal,
} from "./merkleTree.js";

describe("merkleTree", () => {
  it("matches Solidity-style double hash for one leaf", () => {
    const user = "0x1111111111111111111111111111111111111111";
    const token = "0x2222222222222222222222222222222222222222";
    const balance = 10n;
    const tree = buildMerkleTree([{ user, token, balance }]);
    const expected = solidityLeafHash(user, token, balance);
    const leaf: [string, string, bigint] = [
      ethers.getAddress(user),
      ethers.getAddress(token),
      balance,
    ];
    assert.equal(tree.leafHash(leaf), expected);
  });

  it("verifyProofLocal agrees with tree root", () => {
    const a = "0x1000000000000000000000000000000000000001";
    const b = "0x2000000000000000000000000000000000000002";
    const token = "0x3000000000000000000000000000000000000003";
    const tree = buildMerkleTree([
      { user: a, token, balance: 5n },
      { user: b, token, balance: 7n },
    ]);
    const root = tree.root;
    const proofB = getProofForLeaf(tree, b, token, 7n);
    assert.equal(verifyProofLocal(root, b, token, 7n, proofB), true);
    const proofA = getProofForLeaf(tree, a, token, 5n);
    assert.equal(verifyProofLocal(root, a, token, 5n, proofA), true);
  });

  it("native ETH token address encodes as zero", () => {
    const user = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const token = ethers.ZeroAddress;
    const tree = buildMerkleTree([{ user, token, balance: 1n }]);
    const proof = getProofForLeaf(tree, user, token, 1n);
    assert.equal(verifyProofLocal(tree.root, user, token, 1n, proof), true);
  });
});
