/**
 * VeilSwap end-to-end mainnet smoke test (Base, chainId 8453).
 *
 * Flow (single key from .env acts as user + admin + withdraw signer):
 *   1. User deposits 0.01 USDC into VeilSwap by default.
 *   2. Admin commits Merkle root #1 with leaf (user, USDC, amountIn).
 *   3. Admin signs SwapAuth and calls `adminExecuteSwap` (USDC -> ETH via Uniswap V2).
 *   4. Admin commits Merkle root #2 with leaf (user, address(0), amountOut).
 *   5. Admin calls `adminWithdraw` to pay the swapped ETH back to the user.
 *
 * SAFETY: Refuses to run unless `CONFIRM_MAINNET=yes` is set.
 *
 * Required env (auto-loaded from smart-contracts/.env, repo/.env, or api/.env):
 *   - RPC_URL                  Base mainnet JSON-RPC URL
 *   - PRIVATE_KEY              admin = withdrawSigner = caller (also `user` in this test).
 *                              Falls back to ADMIN_PRIVATE_KEY / DEPLOYER_PRIVATE_KEY.
 *   - CONFIRM_MAINNET=yes      safety gate
 *
 * Optional env:
 *   - VEILSWAP_ADDRESS         defaults to deployments/base/VeilSwap.json
 *   - USDC_ADDRESS             defaults to Circle USDC on Base
 *   - SWAP_AMOUNT_USDC         default "0.01" (whole USDC; 6 decimals applied)
 *   - SLIPPAGE_BPS             default 500 (= 5%); amountOutMin = quote * (10000 - bps) / 10000
 *   - ALLOW_ROOT_OVERWRITE     set to "yes" if the deployed VeilSwap already has a non-zero Merkle root
 *
 * Run:
 *   # PowerShell:
 *   $env:CONFIRM_MAINNET=\"yes\"; npm run e2e:veilswap
 *
 *   # bash/zsh:
 *   CONFIRM_MAINNET=yes npm run e2e:veilswap
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
const USDC_DECIMALS = 6;

const VEILSWAP_ABI = [
  "function deposit(address token, uint256 amount) payable",
  "function updateMerkleRoot(bytes32 newRoot)",
  "function getMerkleRoot() view returns (bytes32)",
  "function adminExecuteSwap(address user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, address[] path, bytes32[] proof, uint256 deadline, bytes sig)",
  "function adminWithdraw(address user, address token, uint256 balance, bytes32[] proof, uint256 deadline, bytes sig)",
  "function withdraw(address user, address token, uint256 balance, bytes32[] proof, uint256 deadline, bytes sig)",
  "function router() view returns (address)",
  "function WETH() view returns (address)",
  "function isNullifierSpent(bytes32 nullifier) view returns (bool)",
  "function verifyBalance(address user, address token, uint256 balance, bytes32[] proof) view returns (bool)",
  "event SwapExecuted(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, bytes32 nullifier)",
  "event MerkleRootUpdated(bytes32 indexed newRoot)",
  "event Deposited(address indexed depositor, address indexed token, uint256 amount)",
  "event UserWithdrawal(address indexed user, address indexed token, uint256 amount, bytes32 nullifier)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
];

const ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
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

/**
 * Same scheme as `VeilSwap._nullifier`:
 *   keccak256(abi.encode(root, user, token, balance))
 */
function nullifierFor(root: string, user: string, token: string, balance: bigint): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "address", "uint256"],
      [root, user, token, balance],
    ),
  );
}

/**
 * OpenZeppelin StandardMerkleTree with a single leaf — proof is empty and
 * `tree.root` equals the double-hashed leaf used by `VeilSwap._leaf`.
 */
function buildSingleLeafTree(user: string, token: string, balance: bigint) {
  const tree = StandardMerkleTree.of(
    [[user, token, balance.toString()]],
    ["address", "address", "uint256"],
  );
  const proof = tree.getProof(0);
  return { root: tree.root, proof };
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

/**
 * Load-balanced RPC providers (e.g. Alchemy) can serve `eth_estimateGas` from a
 * read replica that lags one or two blocks behind the node that confirmed our
 * approve, which causes the next deposit's gas estimation to revert with
 * "transfer amount exceeds allowance". Poll the allowance until it propagates.
 */
async function waitForAllowance(
  usdc: ethers.Contract,
  owner: string,
  spender: string,
  min: bigint,
  timeoutMs = 20_000,
): Promise<bigint> {
  const start = Date.now();
  let last = 0n;
  while (Date.now() - start < timeoutMs) {
    last = (await usdc.allowance(owner, spender)) as bigint;
    if (last >= min) return last;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(
    `Allowance for spender ${spender} did not propagate to >= ${min} within ${timeoutMs}ms (last read: ${last}).`,
  );
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
  const usdcAddr = ethers.getAddress(optionalEnv("USDC_ADDRESS", DEFAULT_USDC));
  const swapWholeUsdc = optionalEnv("SWAP_AMOUNT_USDC", "0.01");
  const amountIn = ethers.parseUnits(swapWholeUsdc, USDC_DECIMALS);
  const slippageBps = BigInt(optionalEnv("SLIPPAGE_BPS", "500"));

  const provider = new ethers.JsonRpcProvider(rpcUrl, BASE_CHAIN_ID, {
    staticNetwork: true,
  });
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== BASE_CHAIN_ID) {
    throw new Error(`Expected chainId ${BASE_CHAIN_ID}, got ${net.chainId}`);
  }

  const wallet = new ethers.Wallet(adminPk, provider);
  const user = wallet.address;

  const veilSwap = new ethers.Contract(veilSwapAddr, VEILSWAP_ABI, wallet);
  const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, wallet);

  logHeader("Context");
  console.log({
    chainId: BASE_CHAIN_ID,
    veilSwap: veilSwapAddr,
    usdc: usdcAddr,
    user,
    amountIn: `${swapWholeUsdc} USDC (${amountIn.toString()} raw)`,
    slippageBps: slippageBps.toString(),
  });

  const routerAddr: string = await veilSwap.router();
  const wethAddr: string = await veilSwap.WETH();
  console.log({ router: routerAddr, weth: wethAddr });

  const router = new ethers.Contract(routerAddr, ROUTER_ABI, provider);
  const currentRoot: string = await veilSwap.getMerkleRoot();
  if (currentRoot !== ethers.ZeroHash && process.env.ALLOW_ROOT_OVERWRITE !== "yes") {
    throw new Error(
      `VeilSwap already has a non-zero Merkle root (${currentRoot}). ` +
        "This script commits a single-user test tree and would overwrite existing state. " +
        "Set ALLOW_ROOT_OVERWRITE=yes if this is intentional.",
    );
  }

  const usdcBalBefore: bigint = await usdc.balanceOf(user);
  const ethBalBefore = await provider.getBalance(user);
  console.log("Pre-balances:", {
    usdc: ethers.formatUnits(usdcBalBefore, USDC_DECIMALS),
    eth: ethers.formatEther(ethBalBefore),
  });
  if (usdcBalBefore < amountIn) {
    throw new Error(
      `Wallet ${user} holds ${ethers.formatUnits(usdcBalBefore, USDC_DECIMALS)} USDC, needs >= ${swapWholeUsdc} USDC.`,
    );
  }
  if (ethBalBefore < ethers.parseEther("0.0005")) {
    console.warn("Warning: low ETH balance for gas; transactions may fail.");
  }

  logHeader("Step 1: deposit USDC into VeilSwap");
  const allowance: bigint = await usdc.allowance(user, veilSwapAddr);
  if (allowance < amountIn) {
    await waitTx(
      `approve(VeilSwap, ${amountIn.toString()})`,
      usdc.approve(veilSwapAddr, amountIn),
    );
    const confirmed = await waitForAllowance(usdc, user, veilSwapAddr, amountIn);
    console.log(`Allowance propagated: ${confirmed.toString()}`);
  } else {
    console.log("Allowance already sufficient; skipping approve.");
  }
  await waitTx(
    `deposit(USDC, ${amountIn.toString()})`,
    veilSwap.deposit(usdcAddr, amountIn),
  );

  logHeader("Step 2: admin commits Merkle root #1 (user, USDC, amountIn)");
  const tree1 = buildSingleLeafTree(user, usdcAddr, amountIn);
  console.log(`Root #1: ${tree1.root}`);
  await waitTx(
    `updateMerkleRoot(root1)`,
    veilSwap.updateMerkleRoot(tree1.root),
  );
  await waitForMerkleRoot(veilSwap, tree1.root);
  console.log("Root #1 propagated.");

  logHeader("Step 3: admin executes shielded swap USDC -> ETH");
  const path = [usdcAddr, wethAddr];
  const quoted: bigint[] = await router.getAmountsOut(amountIn, path);
  const quotedOut = quoted[quoted.length - 1];
  const amountOutMin = (quotedOut * (10_000n - slippageBps)) / 10_000n;
  console.log(
    `Uniswap V2 quote: ${ethers.formatEther(quotedOut)} ETH (min after ${slippageBps}bps slippage: ${ethers.formatEther(amountOutMin)} ETH)`,
  );

  const swapDeadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const swapNullifier = nullifierFor(tree1.root, user, usdcAddr, amountIn);
  console.log(`SwapAuth nullifier: ${swapNullifier}`);

  const domain = {
    name: "VeilSwap",
    version: "1",
    chainId: BASE_CHAIN_ID,
    verifyingContract: veilSwapAddr,
  };
  const swapAuthTypes = {
    SwapAuth: [
      { name: "user", type: "address" },
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "nullifier", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const swapSig = await wallet.signTypedData(domain, swapAuthTypes, {
    user,
    tokenIn: usdcAddr,
    tokenOut: ZERO_ADDR,
    amountIn,
    amountOutMin,
    nullifier: swapNullifier,
    deadline: swapDeadline,
  });

  const swapReceipt = await waitTx(
    "adminExecuteSwap",
    veilSwap.adminExecuteSwap(
      user,
      usdcAddr,
      ZERO_ADDR,
      amountIn,
      amountOutMin,
      path,
      tree1.proof,
      swapDeadline,
      swapSig,
    ),
  );

  const iface = new ethers.Interface(VEILSWAP_ABI);
  let amountOut: bigint | null = null;
  for (const log of swapReceipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "SwapExecuted") {
        amountOut = parsed.args.amountOut as bigint;
        break;
      }
    } catch {
      // not our event
    }
  }
  if (amountOut === null) {
    throw new Error("SwapExecuted event not found in receipt; cannot continue.");
  }
  console.log(`Swap output: ${ethers.formatEther(amountOut)} ETH credited to VeilSwap reserves.`);

  logHeader("Step 4: admin commits Merkle root #2 (user, ETH, amountOut)");
  const tree2 = buildSingleLeafTree(user, ZERO_ADDR, amountOut);
  console.log(`Root #2: ${tree2.root}`);
  await waitTx(
    `updateMerkleRoot(root2)`,
    veilSwap.updateMerkleRoot(tree2.root),
  );
  await waitForMerkleRoot(veilSwap, tree2.root);
  console.log("Root #2 propagated.");

  logHeader("Step 5: admin withdraws ETH payout to user");
  const withdrawDeadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const withdrawNullifier = nullifierFor(tree2.root, user, ZERO_ADDR, amountOut);
  console.log(`WithdrawAuth nullifier: ${withdrawNullifier}`);

  const withdrawAuthTypes = {
    WithdrawAuth: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "nullifier", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const withdrawSig = await wallet.signTypedData(domain, withdrawAuthTypes, {
    user,
    token: ZERO_ADDR,
    balance: amountOut,
    nullifier: withdrawNullifier,
    deadline: withdrawDeadline,
  });

  const userEthBeforeWd = await provider.getBalance(user);
  await waitTx(
    "adminWithdraw",
    veilSwap.adminWithdraw(
      user,
      ZERO_ADDR,
      amountOut,
      tree2.proof,
      withdrawDeadline,
      withdrawSig,
    ),
  );
  const userEthAfterWd = await provider.getBalance(user);
  const delta = userEthAfterWd - userEthBeforeWd;

  logHeader("Summary");
  const usdcBalAfter: bigint = await usdc.balanceOf(user);
  console.log({
    user,
    usdc: {
      before: ethers.formatUnits(usdcBalBefore, USDC_DECIMALS),
      after: ethers.formatUnits(usdcBalAfter, USDC_DECIMALS),
    },
    swapAmountOutEth: ethers.formatEther(amountOut),
    userEthDeltaAfterWithdraw: ethers.formatEther(delta),
    note: "delta = amountOut - gas spent on withdraw tx",
  });
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
