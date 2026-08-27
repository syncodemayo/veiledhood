/**
 * VeilSwap end-to-end test against a forked Base mainnet.
 * Uses the REAL Uniswap V4 PoolManager (0x4985…2b2b) — no mocks for the swap path.
 *
 * Setup:
 *   1. Add FORK=1 to smart-contracts/.env  (RPC_URL must already point to Base mainnet)
 *   2. npx hardhat run scripts/test-veilswap-v4-fork.ts
 *
 * What this does:
 *   • Deploys two fresh test ERC-20 tokens (TokenA, TokenB)
 *   • Connects to the real V4 PoolManager on the fork
 *   • Deploys LiquidityHelper, initialises a new pool, adds wide liquidity
 *   • Deploys VeilSwap against the real PoolManager
 *   • Flow A: Alice deposits TokenA → real V4 swap → adminWithdraw TokenB
 *   • Flow B: Bob deposits TokenA → real V4 swap → Bob self-withdraw TokenB
 */

import { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { VeilSwap } from "../typechain-types/contracts/VeilSwap";
import type { MockUSDC } from "../typechain-types/contracts/mock/MockUSDC";
import type { LiquidityHelper } from "../typechain-types/contracts/test/LiquidityHelper";

// ─── Constants ────────────────────────────────────────────────────────────────

const POOL_MANAGER_BASE = "0x498581ff718922c3f8e6a244956af099b2652b2b";

// sqrt(1.0) * 2^96  — initialises the pool at 1:1 price between two equal-decimal tokens
const SQRT_PRICE_1_TO_1 = 79228162514264337593543950336n;

// Tick range: ±600 ticks (10 × tickSpacing=60), price band roughly [0.942, 1.062]
const TICK_LOWER = -600;
const TICK_UPPER =  600;

// Liquidity units.  At 1:1 price this requires ~30,000 raw tokens of each side.
const LIQUIDITY_DELTA = 1_000_000_000_000n; // 1e12

// Pool fee tier (0.3 %) and its tick spacing
const FEE = 3000;
const TICK_SPACING = 60;

// Swap amount: 1 whole token (6 decimals)
const SWAP_AMOUNT_IN = 1_000_000n;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function header(msg: string) {
  console.log(`\n${"═".repeat(62)}\n  ${msg}\n${"═".repeat(62)}`);
}
function step(tag: string, msg: string) { console.log(`  ${tag}  ${msg}`); }

function fmt6(raw: bigint): string {
  const s = raw.toString().padStart(7, "0");
  return s.slice(0, -6) + "." + s.slice(-6);
}

function makePoolKey(a: string, b: string) {
  const [c0, c1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return { currency0: c0, currency1: c1, fee: FEE, tickSpacing: TICK_SPACING, hooks: ethers.ZeroAddress };
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

async function swapAndGetAmountOut(
  vault: VeilSwap,
  admin: Awaited<ReturnType<typeof ethers.getSigner>>,
  user: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  proof: string[],
  deadline: number
): Promise<bigint> {
  const poolKey = makePoolKey(tokenIn, tokenOut);
  const tx = await vault.connect(admin).adminExecuteSwap(
    user, tokenIn, tokenOut, amountIn, 0n, poolKey, proof, deadline
  );
  const receipt = await tx.wait();
  console.log(`     tx: ${tx.hash}`);

  const swapLog = receipt?.logs
    .map(l => { try { return vault.interface.parseLog(l as any); } catch { return null; } })
    .find(e => e?.name === "SwapExecuted");

  return swapLog?.args.amountOut ?? 0n;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Verify we are on a fork
  const network = await ethers.provider.getNetwork();
  const blockNumber = await ethers.provider.getBlockNumber();
  const chainId = Number(network.chainId);

  if (chainId !== 31337) {
    throw new Error(`Expected hardhat fork network (chainId 31337), got ${chainId}. Is FORK=1 set?`);
  }

  // Confirm PoolManager code exists at the fork address
  const pmCode = await ethers.provider.getCode(POOL_MANAGER_BASE);
  if (pmCode === "0x") {
    throw new Error(`No code at PoolManager ${POOL_MANAGER_BASE}. Is RPC_URL pointing to Base mainnet?`);
  }

  console.log(`\n  Fork : Base mainnet (chainId 8453 → hardhat 31337)`);
  console.log(`  Block: ${blockNumber.toLocaleString()}`);
  console.log(`  PoolManager (real): ${POOL_MANAGER_BASE}`);

  const [admin, alice, bob] = await ethers.getSigners();
  console.log(`  Admin / signer : ${admin.address}`);
  console.log(`  Alice          : ${alice.address}`);
  console.log(`  Bob            : ${bob.address}`);

  // ── Deploy ─────────────────────────────────────────────────────────────────
  header("DEPLOY  (fresh contracts on top of the fork)");

  // Large supply: 1 billion tokens (6 decimals) = 1e15 raw
  const SUPPLY = 1_000_000_000_000_000n;

  const Mock = await ethers.getContractFactory("MockUSDC");
  const tokenA = (await Mock.deploy(SUPPLY)) as MockUSDC;
  await tokenA.waitForDeployment();

  const tokenB = (await Mock.deploy(SUPPLY)) as MockUSDC;
  await tokenB.waitForDeployment();

  const TA = await tokenA.getAddress();
  const TB = await tokenB.getAddress();

  const LH = await ethers.getContractFactory("LiquidityHelper");
  const lh = (await LH.deploy(POOL_MANAGER_BASE)) as LiquidityHelper;
  await lh.waitForDeployment();

  const Vault = await ethers.getContractFactory("VeilSwap");
  const vault = (await Vault.deploy(admin.address, admin.address, POOL_MANAGER_BASE)) as VeilSwap;
  await vault.waitForDeployment();

  const VAULT = await vault.getAddress();
  const LH_ADDR = await lh.getAddress();
  const poolKey = makePoolKey(TA, TB);

  step("TokenA     :", TA);
  step("TokenB     :", TB);
  step("LiqHelper  :", LH_ADDR);
  step("VeilSwap   :", VAULT);
  step("PoolKey    :", `{c0: ${poolKey.currency0.slice(0,10)}…, c1: ${poolKey.currency1.slice(0,10)}…, fee: ${FEE}}`);

  // ── Setup V4 pool ──────────────────────────────────────────────────────────
  header("SETUP REAL V4 POOL");

  // Initialize — direct call, no unlock needed
  const initTx = await lh.initializePool(poolKey, SQRT_PRICE_1_TO_1);
  const initReceipt = await initTx.wait();
  step("Pool init tx :", initTx.hash);

  // Pre-fund LiquidityHelper with 10M tokens of each (1e13 raw)
  const LH_FUND = 10_000_000_000_000n; // 10M tokens
  await (await tokenA.transfer(LH_ADDR, LH_FUND)).wait();
  await (await tokenB.transfer(LH_ADDR, LH_FUND)).wait();
  step("LH funded    :", `10,000,000 TokenA + 10,000,000 TokenB`);

  // Add liquidity via unlock→modifyLiquidity
  const liquidityTx = await lh.addLiquidity(poolKey, TICK_LOWER, TICK_UPPER, LIQUIDITY_DELTA);
  const liquidityReceipt = await liquidityTx.wait();
  step("Add liq tx   :", liquidityTx.hash);
  step("Tick range   :", `[${TICK_LOWER}, ${TICK_UPPER}]  (~0.942 – 1.062 price band)`);
  step("Liquidity    :", LIQUIDITY_DELTA.toLocaleString());
  step("Pool is live :", "✓  ready for real swaps");

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOW A — Alice: deposit TokenA → real V4 swap → adminWithdraw TokenB
  // ══════════════════════════════════════════════════════════════════════════
  header("FLOW A  —  Alice: TokenA deposit → V4 swap → adminWithdraw");

  // A1. Deposit
  await (await tokenA.transfer(alice.address, SWAP_AMOUNT_IN)).wait();
  await (await tokenA.connect(alice).approve(VAULT, SWAP_AMOUNT_IN)).wait();
  await (await vault.connect(alice).deposit(TA, SWAP_AMOUNT_IN)).wait();

  step("A1 deposit   :", `${fmt6(SWAP_AMOUNT_IN)} TokenA  (vault reserves: ${fmt6(await vault.getReserves(TA))})`);

  // A2. Merkle root (leaf: alice, tokenA, amountIn)
  const treeA1 = StandardMerkleTree.of([[alice.address, TA, SWAP_AMOUNT_IN.toString()]], ["address","address","uint256"]);
  const rootA1 = treeA1.root as string;
  const proofA1 = treeA1.getProof(0) as string[];
  await (await vault.connect(admin).updateMerkleRoot(rootA1)).wait();

  step("A2 root      :", rootA1.slice(0, 20) + "…");
  step("   verified  :", String(await vault.verifyBalance(alice.address, TA, SWAP_AMOUNT_IN, proofA1)));

  // A3. Real V4 swap
  step("A3 swapping  :", `${fmt6(SWAP_AMOUNT_IN)} TokenA  via REAL V4 PoolManager…`);
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const amountOutA = await swapAndGetAmountOut(vault, admin, alice.address, TA, TB, SWAP_AMOUNT_IN, proofA1, deadline);

  const feeA = SWAP_AMOUNT_IN - amountOutA;
  step("   in        :", `${fmt6(SWAP_AMOUNT_IN)} TokenA`);
  step("   out       :", `${fmt6(amountOutA)} TokenB`);
  step("   fee+slip  :", `${fmt6(feeA)} (expected ~${fmt6(3000n)} for 0.3% fee)`);
  step("   reserves  :", `TokenA=${fmt6(await vault.getReserves(TA))}  TokenB=${fmt6(await vault.getReserves(TB))}`);

  // A4. Update Merkle root (leaf: alice, tokenB, amountOut)
  const treeA2 = StandardMerkleTree.of([[alice.address, TB, amountOutA.toString()]], ["address","address","uint256"]);
  const rootA2 = treeA2.root as string;
  const proofA2 = treeA2.getProof(0) as string[];
  await (await vault.connect(admin).updateMerkleRoot(rootA2)).wait();
  step("A4 root      :", rootA2.slice(0, 20) + "…  (post-swap, tokenB balance)");

  // A5. adminWithdraw TokenB → Alice
  const nullA = nullifier(rootA2, alice.address, TB, amountOutA);
  const deadlineA = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const sigA = await signWithdrawAuth(admin, vault, alice.address, TB, amountOutA, nullA, deadlineA);

  const bBefore = await tokenB.balanceOf(alice.address);
  const wTx = await vault.connect(admin).adminWithdraw(alice.address, TB, amountOutA, proofA2, deadlineA, sigA);
  await wTx.wait();
  const bAfter = await tokenB.balanceOf(alice.address);
  step("A5 tx        :", wTx.hash);
  step("   received  :", `${fmt6(bAfter - bBefore)} TokenB  ✓`);
  step("   nullifier :", `spent=${await vault.isNullifierSpent(nullA)}`);
  step("   reserves  :", `TokenB=${fmt6(await vault.getReserves(TB))}`);

  // ══════════════════════════════════════════════════════════════════════════
  //  FLOW B — Bob: deposit TokenA → real V4 swap → self-withdraw TokenB
  // ══════════════════════════════════════════════════════════════════════════
  header("FLOW B  —  Bob: TokenA deposit → V4 swap → self-withdraw");

  // B1. Deposit
  await (await tokenA.transfer(bob.address, SWAP_AMOUNT_IN)).wait();
  await (await tokenA.connect(bob).approve(VAULT, SWAP_AMOUNT_IN)).wait();
  await (await vault.connect(bob).deposit(TA, SWAP_AMOUNT_IN)).wait();
  step("B1 deposit   :", `${fmt6(SWAP_AMOUNT_IN)} TokenA`);

  // B2. Merkle root
  const treeB1 = StandardMerkleTree.of([[bob.address, TA, SWAP_AMOUNT_IN.toString()]], ["address","address","uint256"]);
  const rootB1 = treeB1.root as string;
  const proofB1 = treeB1.getProof(0) as string[];
  await (await vault.connect(admin).updateMerkleRoot(rootB1)).wait();
  step("B2 root      :", rootB1.slice(0, 20) + "…");

  // B3. Real V4 swap
  step("B3 swapping  :", `${fmt6(SWAP_AMOUNT_IN)} TokenA  via REAL V4 PoolManager…`);
  const deadline2 = Math.floor(Date.now() / 1000) + 3600;
  const amountOutB = await swapAndGetAmountOut(vault, admin, bob.address, TA, TB, SWAP_AMOUNT_IN, proofB1, deadline2);

  step("   in        :", `${fmt6(SWAP_AMOUNT_IN)} TokenA`);
  step("   out       :", `${fmt6(amountOutB)} TokenB`);
  step("   reserves  :", `TokenA=${fmt6(await vault.getReserves(TA))}  TokenB=${fmt6(await vault.getReserves(TB))}`);

  // B4. Merkle root
  const treeB2 = StandardMerkleTree.of([[bob.address, TB, amountOutB.toString()]], ["address","address","uint256"]);
  const rootB2 = treeB2.root as string;
  const proofB2 = treeB2.getProof(0) as string[];
  await (await vault.connect(admin).updateMerkleRoot(rootB2)).wait();
  step("B4 root      :", rootB2.slice(0, 20) + "…  (post-swap)");

  // B5. Bob self-withdraw
  const nullB = nullifier(rootB2, bob.address, TB, amountOutB);
  const deadlineB = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const sigB = await signWithdrawAuth(admin, vault, bob.address, TB, amountOutB, nullB, deadlineB);

  const bBobBefore = await tokenB.balanceOf(bob.address);
  const wTxB = await vault.connect(bob).withdraw(bob.address, TB, amountOutB, proofB2, deadlineB, sigB);
  await wTxB.wait();
  const bBobAfter = await tokenB.balanceOf(bob.address);
  step("B5 tx        :", wTxB.hash);
  step("   received  :", `${fmt6(bBobAfter - bBobBefore)} TokenB  ✓`);
  step("   nullifier :", `spent=${await vault.isNullifierSpent(nullB)}`);

  // ── Summary ────────────────────────────────────────────────────────────────
  header("SUMMARY");
  console.log(`  Flow A  Alice  adminWithdraw   ${fmt6(bAfter - bBefore)} TokenB   ✓`);
  console.log(`  Flow B  Bob    self-withdraw   ${fmt6(bBobAfter - bBobBefore)} TokenB   ✓`);
  console.log(`\n  All transactions hit the REAL Uniswap V4 PoolManager on Base.`);
  console.log(`  Swap outputs reflect the actual 0.3% fee from the on-chain pool.\n`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
