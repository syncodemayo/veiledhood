/**
 * VeilSwap recovery script (Base mainnet, chainId 8453).
 *
 * Purpose:
 *   Pulls reserves that are stuck inside VeilSwap (e.g. after a partial
 *   e2e run where the swap consumed a nullifier but the withdraw never
 *   executed). It does this by committing a *multi-leaf* Merkle tree
 *   over all balances that need to be paid out, then calling
 *   `adminWithdraw` once per leaf with the matching proof and a fresh
 *   EIP-712 `WithdrawAuth` signature.
 *
 * Why a fresh multi-leaf root?
 *   The contract's nullifier is `keccak256(abi.encode(root, user, token, balance))`.
 *   If we reuse a previously committed single-leaf root whose nullifier
 *   was already consumed by `adminExecuteSwap` (or anything else), the
 *   withdraw will revert with `NullifierAlreadyUsed()`. A new root over
 *   2+ leaves changes the root bytes, which changes every nullifier.
 *
 * SAFETY: Refuses to run unless `CONFIRM_MAINNET=yes`.
 *
 * Required env (auto-loaded from smart-contracts/.env, repo/.env, or api/.env):
 *   - RPC_URL                Base mainnet JSON-RPC URL.
 *   - PRIVATE_KEY            admin = withdrawSigner = caller (must equal the
 *                            VeilSwap admin and EIP-712 withdraw signer).
 *                            Falls back to ADMIN_PRIVATE_KEY / DEPLOYER_PRIVATE_KEY.
 *   - CONFIRM_MAINNET=yes    safety gate.
 *
 * Optional env:
 *   - VEILSWAP_ADDRESS       defaults to deployments/base/VeilSwap.json (0x75a6…Cf6C).
 *   - RECOVER_USER           defaults to the wallet derived from PRIVATE_KEY.
 *   - RECOVER_LEAVES_JSON    JSON array of `{ token, balance }` to pay out.
 *                            `token` is hex (0x0…0 for native ETH).
 *                            `balance` is a decimal string of raw units (no decimals applied).
 *                            If unset, the script defaults to the currently known
 *                            stuck reserves on the deployed VeilSwap:
 *                              [{ token: USDC, balance: "20000" },
 *                               { token: 0x0, balance: "9473027280205" }]
 *
 * Run:
 *   # PowerShell:
 *   $env:CONFIRM_MAINNET="yes"; npm run recover:veilswap
 *
 *   # bash/zsh:
 *   CONFIRM_MAINNET=yes npm run recover:veilswap
 */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ethers } from "ethers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

for (const rel of ["../.env", "../../.env", "../../api/.env"]) {
  const abs = path.resolve(__dirname, rel);
  if (fs.existsSync(abs)) dotenv.config({ path: abs });
}

const BASE_CHAIN_ID = 8453;
const DEFAULT_VEILSWAP = "0x75a6E9D60013CAe3dC9706F589fa653Cf9b3Cf6C";
const DEFAULT_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/**
 * Defaults are the reserves observed stuck after the two failed e2e runs at
 * 0.02 USDC. Override via RECOVER_LEAVES_JSON if you re-run this in the
 * future.
 */
const DEFAULT_LEAVES: Array<{ token: string; balance: string }> = [
  { token: DEFAULT_USDC, balance: "20000" },
  { token: ZERO_ADDR, balance: "9473027280205" },
];

const VEILSWAP_ABI = [
  "function updateMerkleRoot(bytes32 newRoot)",
  "function getMerkleRoot() view returns (bytes32)",
  "function adminWithdraw(address user, address token, uint256 balance, bytes32[] proof, uint256 deadline, bytes sig)",
  "function isNullifierSpent(bytes32 nullifier) view returns (bool)",
  "function verifyBalance(address user, address token, uint256 balance, bytes32[] proof) view returns (bool)",
  "event AdminWithdrawal(address indexed user, address indexed token, uint256 amount, bytes32 nullifier)",
  "event MerkleRootUpdated(bytes32 indexed newRoot)",
];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in environment.`);
  return value;
}

/** keccak256(abi.encode(root, user, token, balance)) — matches VeilSwap._nullifier. */
function nullifierFor(root: string, user: string, token: string, balance: bigint): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "address", "uint256"],
      [root, user, token, balance],
    ),
  );
}

function logHeader(label: string): void {
  console.log("\n──────────────────────────────────────────────");
  console.log(`▶ ${label}`);
  console.log("──────────────────────────────────────────────");
}

async function waitTx(
  label: string,
  txp: Promise<ethers.TransactionResponse>,
): Promise<ethers.TransactionReceipt> {
  const tx = await txp;
  console.log(`${label} → ${tx.hash}`);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} failed (status ${receipt?.status ?? "null"}): ${tx.hash}`);
  }
  console.log(`${label} confirmed in block ${receipt.blockNumber} (gas ${receipt.gasUsed})`);
  return receipt;
}

async function waitForMerkleRoot(
  veilSwap: ethers.Contract,
  expectedRoot: string,
  timeoutMs = 20_000,
): Promise<void> {
  const expected = expectedRoot.toLowerCase();
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeoutMs) {
    last = ((await veilSwap.getMerkleRoot()) as string).toLowerCase();
    if (last === expected) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(
    `Merkle root ${expectedRoot} did not propagate within ${timeoutMs}ms (last read: ${last}).`,
  );
}

interface RecoverLeaf {
  token: string;
  balance: bigint;
}

function parseLeaves(raw: string | undefined): RecoverLeaf[] {
  const source = raw && raw.trim().length > 0 ? JSON.parse(raw) : DEFAULT_LEAVES;
  if (!Array.isArray(source) || source.length === 0) {
    throw new Error("RECOVER_LEAVES_JSON must be a non-empty JSON array.");
  }
  return source.map((entry: { token: string; balance: string }, i: number) => {
    if (!entry || typeof entry.token !== "string" || typeof entry.balance !== "string") {
      throw new Error(`Invalid leaf at index ${i}: ${JSON.stringify(entry)}`);
    }
    const token = ethers.getAddress(entry.token);
    const balance = BigInt(entry.balance);
    if (balance <= 0n) {
      throw new Error(`Leaf ${i} balance must be positive (got ${balance.toString()}).`);
    }
    return { token, balance };
  });
}

async function main(): Promise<void> {
  if (process.env.CONFIRM_MAINNET !== "yes") {
    throw new Error(
      "Refusing to run on Base mainnet. Set CONFIRM_MAINNET=yes to proceed.",
    );
  }

  const rpcUrl = requireEnv("RPC_URL");
  const adminPk =
    process.env.PRIVATE_KEY?.trim() ||
    process.env.ADMIN_PRIVATE_KEY?.trim() ||
    process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!adminPk) {
    throw new Error("Missing PRIVATE_KEY (or ADMIN_PRIVATE_KEY / DEPLOYER_PRIVATE_KEY) in environment.");
  }

  const veilSwapAddr = ethers.getAddress(optionalEnv("VEILSWAP_ADDRESS", DEFAULT_VEILSWAP));

  const provider = new ethers.JsonRpcProvider(rpcUrl, BASE_CHAIN_ID, {
    staticNetwork: true,
  });
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== BASE_CHAIN_ID) {
    throw new Error(`Expected chainId ${BASE_CHAIN_ID}, got ${net.chainId}`);
  }

  const wallet = new ethers.Wallet(adminPk, provider);
  const user = ethers.getAddress(optionalEnv("RECOVER_USER", wallet.address));
  const veilSwap = new ethers.Contract(veilSwapAddr, VEILSWAP_ABI, wallet);

  const leaves = parseLeaves(process.env.RECOVER_LEAVES_JSON);

  logHeader("Context");
  console.log({
    chainId: BASE_CHAIN_ID,
    veilSwap: veilSwapAddr,
    caller: wallet.address,
    recoverUser: user,
    leaves: leaves.map((l) => ({ token: l.token, balance: l.balance.toString() })),
  });

  // Sanity-check that the actual contract balance can cover each requested
  // leaf. _reserves is not exposed publicly, but actual >= reserved >= leaf
  // is a necessary (not sufficient) condition.
  for (const leaf of leaves) {
    let actual: bigint;
    let label: string;
    if (leaf.token === ZERO_ADDR) {
      actual = await provider.getBalance(veilSwapAddr);
      label = "ETH";
    } else {
      const erc20 = new ethers.Contract(leaf.token, ERC20_ABI, provider);
      actual = (await erc20.balanceOf(veilSwapAddr)) as bigint;
      try {
        label = (await erc20.symbol()) as string;
      } catch {
        label = leaf.token;
      }
    }
    if (actual < leaf.balance) {
      throw new Error(
        `Contract holds ${actual.toString()} ${label}, less than requested withdrawal ${leaf.balance.toString()}.`,
      );
    }
    console.log(`Contract ${label} balance: ${actual.toString()} (need ${leaf.balance.toString()})`);
  }

  // Build the multi-leaf StandardMerkleTree. The leaf encoding matches
  // VeilSwap._leaf: keccak256(bytes.concat(keccak256(abi.encode(user, token, balance)))).
  const treeValues: [string, string, string][] = leaves.map((l) => [
    user,
    l.token,
    l.balance.toString(),
  ]);
  const tree = StandardMerkleTree.of(treeValues, ["address", "address", "uint256"]);
  const newRoot = tree.root;

  // Pair each leaf with its proof in tree order.
  const proofs: string[][] = treeValues.map((_, i) => tree.getProof(i));

  logHeader("New Merkle tree");
  console.log({ root: newRoot, leafCount: treeValues.length });
  for (let i = 0; i < treeValues.length; i++) {
    console.log(`leaf[${i}] = ${JSON.stringify(treeValues[i])} proof=${JSON.stringify(proofs[i])}`);
  }

  // Reject the (extremely unlikely) case where a freshly built root collides
  // with an already-consumed nullifier for any leaf in the set.
  for (let i = 0; i < leaves.length; i++) {
    const n = nullifierFor(newRoot, user, leaves[i].token, leaves[i].balance);
    const spent: boolean = await veilSwap.isNullifierSpent(n);
    if (spent) {
      throw new Error(
        `Nullifier for leaf ${i} (${n}) is already spent under root ${newRoot}; aborting.`,
      );
    }
  }

  logHeader("Step 1: commit recovery Merkle root");
  const currentRoot: string = await veilSwap.getMerkleRoot();
  if (currentRoot.toLowerCase() === newRoot.toLowerCase()) {
    console.log("Current on-chain root already matches recovery root; skipping update.");
  } else {
    console.log(`Replacing on-chain root ${currentRoot} → ${newRoot}`);
    await waitTx(
      `updateMerkleRoot(${newRoot})`,
      veilSwap.updateMerkleRoot(newRoot),
    );
    await waitForMerkleRoot(veilSwap, newRoot);
    console.log("Recovery root propagated.");
  }

  logHeader("Step 2: adminWithdraw per leaf");
  const domain = {
    name: "VeilSwap",
    version: "1",
    chainId: BASE_CHAIN_ID,
    verifyingContract: veilSwapAddr,
  };
  const withdrawAuthTypes = {
    WithdrawAuth: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "nullifier", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const results: Array<{
    token: string;
    balance: string;
    nullifier: string;
    txHash: string;
  }> = [];

  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    const proof = proofs[i];

    // Pre-flight: ensure the proof actually verifies against the live root.
    const verifies: boolean = await veilSwap.verifyBalance(user, leaf.token, leaf.balance, proof);
    if (!verifies) {
      throw new Error(
        `verifyBalance returned false for leaf ${i} (${JSON.stringify(treeValues[i])}); ` +
          "the on-chain root does not match the built tree.",
      );
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
    const nullifier = nullifierFor(newRoot, user, leaf.token, leaf.balance);
    const sig = await wallet.signTypedData(domain, withdrawAuthTypes, {
      user,
      token: leaf.token,
      balance: leaf.balance,
      nullifier,
      deadline,
    });

    console.log(
      `\nWithdraw leaf[${i}] token=${leaf.token} balance=${leaf.balance.toString()} nullifier=${nullifier}`,
    );
    const receipt = await waitTx(
      `adminWithdraw(leaf ${i})`,
      veilSwap.adminWithdraw(user, leaf.token, leaf.balance, proof, deadline, sig),
    );
    results.push({
      token: leaf.token,
      balance: leaf.balance.toString(),
      nullifier,
      txHash: receipt.hash,
    });
  }

  logHeader("Summary");
  console.log({
    user,
    recoveryRoot: newRoot,
    withdrawals: results,
  });
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
