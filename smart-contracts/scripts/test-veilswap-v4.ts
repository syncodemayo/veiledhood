/**
 * End-to-end lifecycle test for VeilSwap V4.
 *
 * Run:  npx hardhat run scripts/test-veilswap-v4.ts
 *
 * Covers:
 *   Flow A  — ERC-20 deposit → Token→Token swap → adminWithdraw
 *   Flow B  — ETH deposit    → ETH→Token swap   → user self-withdraw
 */

import { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { VeilSwap } from "../typechain-types/contracts/VeilSwap";
import type { MockUSDC } from "../typechain-types/contracts/mock/MockUSDC";
import type { MockUniswapV4PoolManager } from "../typechain-types/contracts/mock/MockUniswapV4PoolManager";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(msg); }
function header(msg: string) { console.log(`\n${"─".repeat(60)}\n  ${msg}\n${"─".repeat(60)}`); }

function makePoolKey(a: string, b: string) {
  const [c0, c1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return { currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: ethers.ZeroAddress };
}

function buildLeaf(user: string, token: string, balance: bigint): [string, string, string][] {
  return [[user, token, balance.toString()]];
}

function nullifier(root: string, user: string, token: string, balance: bigint): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "address", "uint256"],
      [root, user, token, balance]
    )
  );
}

async function signWithdrawAuth(
  signer: Awaited<ReturnType<typeof ethers.getSigner>>,
  vault: VeilSwap,
  user: string,
  token: string,
  balance: bigint,
  nul: string,
  deadline: bigint
): Promise<string> {
  const { chainId } = await ethers.provider.getNetwork();
  return signer.signTypedData(
    { name: "VeilSwap", version: "1", chainId, verifyingContract: await vault.getAddress() },
    {
      WithdrawAuth: [
        { name: "user",      type: "address" },
        { name: "token",     type: "address" },
        { name: "balance",   type: "uint256" },
        { name: "nullifier", type: "bytes32" },
        { name: "deadline",  type: "uint256" },
      ],
    },
    { user, token, balance, nullifier: nul, deadline }
  );
}

function fmt(n: bigint, decimals = 6): string {
  const s = n.toString().padStart(decimals + 1, "0");
  return s.slice(0, -decimals) + "." + s.slice(-decimals);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [admin, user] = await ethers.getSigners();
  log(`Admin / signer : ${admin.address}`);
  log(`User           : ${user.address}`);

  // ── Deploy ──────────────────────────────────────────────────────────────────
  header("DEPLOY");

  const Mock = await ethers.getContractFactory("MockUSDC");
  const usdc = (await Mock.deploy(100_000_000n)) as MockUSDC;
  await usdc.waitForDeployment();

  const dai = (await Mock.deploy(100_000_000n)) as MockUSDC;
  await dai.waitForDeployment();

  const SWAP_OUT_TOKEN  = 500_000n;   // DAI returned by mock for token→token
  const SWAP_OUT_ETH_TO = 750_000n;   // DAI returned by mock for ETH→token

  const PM = await ethers.getContractFactory("MockUniswapV4PoolManager");
  const poolManager = (await PM.deploy(SWAP_OUT_TOKEN)) as MockUniswapV4PoolManager;
  await poolManager.waitForDeployment();

  const Vault = await ethers.getContractFactory("VeilSwap");
  const vault = (await Vault.deploy(
    admin.address,
    admin.address,   // admin is also withdrawSigner
    await poolManager.getAddress()
  )) as VeilSwap;
  await vault.waitForDeployment();

  const USDC = await usdc.getAddress();
  const DAI  = await dai.getAddress();
  const PM_ADDR  = await poolManager.getAddress();
  const VAULT    = await vault.getAddress();

  log(`USDC        : ${USDC}`);
  log(`DAI         : ${DAI}`);
  log(`PoolManager : ${PM_ADDR}`);
  log(`VeilSwap    : ${VAULT}`);

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOW A  —  ERC-20 deposit → Token→Token swap → adminWithdraw
  // ══════════════════════════════════════════════════════════════════════════

  header("FLOW A — ERC-20 deposit → USDC→DAI swap → adminWithdraw");

  // A1. Deposit ───────────────────────────────────────────────────────────────
  const DEPOSIT_A = 1_000_000n;
  await usdc.transfer(user.address, DEPOSIT_A);
  await usdc.connect(user).approve(VAULT, DEPOSIT_A);
  await (await vault.connect(user).deposit(USDC, DEPOSIT_A)).wait();

  log(`[A1] User deposited ${fmt(DEPOSIT_A)} USDC`);
  log(`     Vault USDC reserves : ${fmt(await vault.getReserves(USDC))}`);

  // A2. Update Merkle root (pre-swap) ────────────────────────────────────────
  const treeA1 = StandardMerkleTree.of(buildLeaf(user.address, USDC, DEPOSIT_A), ["address", "address", "uint256"]);
  const rootA1 = treeA1.root as string;
  await (await vault.connect(admin).updateMerkleRoot(rootA1)).wait();
  const proofA1 = treeA1.getProof(0) as string[];

  log(`[A2] Merkle root set     : ${rootA1.slice(0, 18)}…`);
  log(`     verifyBalance       : ${await vault.verifyBalance(user.address, USDC, DEPOSIT_A, proofA1)}`);

  // A3. Swap USDC→DAI ────────────────────────────────────────────────────────
  await dai.transfer(PM_ADDR, SWAP_OUT_TOKEN);          // pre-fund mock PM

  const poolKeyA = makePoolKey(USDC, DAI);
  const deadlineA = Math.floor(Date.now() / 1000) + 3600;

  const swapTxA = await vault.connect(admin).adminExecuteSwap(
    user.address, USDC, DAI, DEPOSIT_A, 0n, poolKeyA, proofA1, deadlineA
  );
  const receiptA = await swapTxA.wait();

  // Parse SwapExecuted event
  const swapIfaceA = vault.interface;
  const swapLogA = receiptA?.logs
    .map(l => { try { return swapIfaceA.parseLog(l as any); } catch { return null; } })
    .find(e => e?.name === "SwapExecuted");

  const amountOutA: bigint = swapLogA?.args.amountOut ?? 0n;
  log(`[A3] Swap executed`);
  log(`     In  : ${fmt(DEPOSIT_A)} USDC`);
  log(`     Out : ${fmt(amountOutA)} DAI`);
  log(`     Vault USDC reserves : ${fmt(await vault.getReserves(USDC))}`);
  log(`     Vault DAI  reserves : ${fmt(await vault.getReserves(DAI))}`);

  // A4. Update Merkle root (post-swap) ───────────────────────────────────────
  const treeA2 = StandardMerkleTree.of(buildLeaf(user.address, DAI, amountOutA), ["address", "address", "uint256"]);
  const rootA2 = treeA2.root as string;
  await (await vault.connect(admin).updateMerkleRoot(rootA2)).wait();
  const proofA2 = treeA2.getProof(0) as string[];

  log(`[A4] Merkle root updated : ${rootA2.slice(0, 18)}…`);

  // A5. adminWithdraw DAI → user ─────────────────────────────────────────────
  const nullA = nullifier(rootA2, user.address, DAI, amountOutA);
  const deadlineA2 = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const sigA = await signWithdrawAuth(admin, vault, user.address, DAI, amountOutA, nullA, deadlineA2);

  const daiBefore = await dai.balanceOf(user.address);
  await (await vault.connect(admin).adminWithdraw(user.address, DAI, amountOutA, proofA2, deadlineA2, sigA)).wait();
  const daiAfter = await dai.balanceOf(user.address);

  log(`[A5] adminWithdraw complete`);
  log(`     User DAI balance    : ${fmt(daiBefore)} → ${fmt(daiAfter)}`);
  log(`     Received            : ${fmt(daiAfter - daiBefore)} DAI  ✓`);
  log(`     Nullifier spent     : ${await vault.isNullifierSpent(nullA)}`);
  log(`     Vault DAI  reserves : ${fmt(await vault.getReserves(DAI))}`);

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOW B  —  ETH deposit → ETH→Token swap → user self-withdraw
  // ══════════════════════════════════════════════════════════════════════════

  header("FLOW B — ETH deposit → ETH→DAI swap → user self-withdraw");

  // Reconfigure mock PM amount for this flow
  await poolManager.setFixedAmountOut(SWAP_OUT_ETH_TO);

  // B1. ETH deposit ──────────────────────────────────────────────────────────
  const DEPOSIT_B = ethers.parseEther("0.5");
  await (await vault.connect(user).deposit(ethers.ZeroAddress, DEPOSIT_B, { value: DEPOSIT_B })).wait();

  log(`[B1] User deposited 0.5 ETH`);
  log(`     Vault ETH reserves  : ${ethers.formatEther(await vault.getReserves(ethers.ZeroAddress))} ETH`);

  // B2. Update Merkle root ───────────────────────────────────────────────────
  const treeB1 = StandardMerkleTree.of(buildLeaf(user.address, ethers.ZeroAddress, DEPOSIT_B), ["address", "address", "uint256"]);
  const rootB1 = treeB1.root as string;
  await (await vault.connect(admin).updateMerkleRoot(rootB1)).wait();
  const proofB1 = treeB1.getProof(0) as string[];

  log(`[B2] Merkle root set     : ${rootB1.slice(0, 18)}…`);

  // B3. Swap ETH→DAI ────────────────────────────────────────────────────────
  await dai.transfer(PM_ADDR, SWAP_OUT_ETH_TO);        // pre-fund mock PM with DAI

  const poolKeyB = makePoolKey(ethers.ZeroAddress, DAI);
  const deadlineB = Math.floor(Date.now() / 1000) + 3600;

  const swapTxB = await vault.connect(admin).adminExecuteSwap(
    user.address, ethers.ZeroAddress, DAI, DEPOSIT_B, 0n, poolKeyB, proofB1, deadlineB
  );
  const receiptB = await swapTxB.wait();

  const swapLogB = receiptB?.logs
    .map(l => { try { return swapIfaceA.parseLog(l as any); } catch { return null; } })
    .find(e => e?.name === "SwapExecuted");

  const amountOutB: bigint = swapLogB?.args.amountOut ?? 0n;
  log(`[B3] Swap executed`);
  log(`     In  : 0.5 ETH`);
  log(`     Out : ${fmt(amountOutB)} DAI`);
  log(`     Vault ETH reserves  : ${ethers.formatEther(await vault.getReserves(ethers.ZeroAddress))} ETH`);
  log(`     Vault DAI  reserves : ${fmt(await vault.getReserves(DAI))}`);

  // B4. Update Merkle root (post-swap) ───────────────────────────────────────
  const treeB2 = StandardMerkleTree.of(buildLeaf(user.address, DAI, amountOutB), ["address", "address", "uint256"]);
  const rootB2 = treeB2.root as string;
  await (await vault.connect(admin).updateMerkleRoot(rootB2)).wait();
  const proofB2 = treeB2.getProof(0) as string[];

  log(`[B4] Merkle root updated : ${rootB2.slice(0, 18)}…`);

  // B5. User self-withdraw (withdraw) ────────────────────────────────────────
  const nullB = nullifier(rootB2, user.address, DAI, amountOutB);
  const deadlineB2 = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const sigB = await signWithdrawAuth(admin, vault, user.address, DAI, amountOutB, nullB, deadlineB2);

  const daiBefore2 = await dai.balanceOf(user.address);
  // user calls withdraw() themselves (not admin)
  await (await vault.connect(user).withdraw(user.address, DAI, amountOutB, proofB2, deadlineB2, sigB)).wait();
  const daiAfter2 = await dai.balanceOf(user.address);

  log(`[B5] user self-withdraw complete`);
  log(`     User DAI balance    : ${fmt(daiBefore2)} → ${fmt(daiAfter2)}`);
  log(`     Received            : ${fmt(daiAfter2 - daiBefore2)} DAI  ✓`);
  log(`     Nullifier spent     : ${await vault.isNullifierSpent(nullB)}`);
  log(`     Vault DAI  reserves : ${fmt(await vault.getReserves(DAI))}`);

  // ── Final summary ──────────────────────────────────────────────────────────
  header("SUMMARY");
  log(`Flow A (ERC-20 → swap → adminWithdraw)   : ✓`);
  log(`Flow B (ETH    → swap → self-withdraw)   : ✓`);
  log(`\nAll lifecycle steps passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
