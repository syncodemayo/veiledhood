/**
 * VeilSwap end-to-end test against REAL Base mainnet V4 pools.
 * Requires FORK=1 in .env with RPC_URL pointing at Base mainnet.
 *
 *   npx hardhat run scripts/test-veilswap-real-pools.ts
 *
 * Tokens used (real Base mainnet addresses):
 *   USDC  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *   DAI   0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb
 *   ETH   native (address(0))
 *
 * Flows:
 *   A — Alice:   USDC deposit  →  USDC→ETH  real V4 swap  →  adminWithdraw ETH
 *   B — Bob:     ETH  deposit  →  ETH→USDC  real V4 swap  →  self-withdraw  USDC
 *   C — Charlie: ETH  deposit  →  ETH→DAI   real V4 swap  →  self-withdraw  DAI   (skipped if no pool)
 */

import hre, { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import type { VeilSwap } from "../typechain-types/contracts/VeilSwap";

// ─── Base mainnet addresses ───────────────────────────────────────────────────

const POOL_MANAGER  = "0x498581ff718922c3f8e6a244956af099b2652b2b";
const USDC_ADDR     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DAI_ADDR      = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb";
const ETH_ADDR      = ethers.ZeroAddress;

// V4 pools slot: POOLS_SLOT = 6 (from StateLibrary.sol)
const POOLS_SLOT = 6n;

// ─── Minimal ABIs ─────────────────────────────────────────────────────────────

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

const USDC_MINT_ABI = [
  "function masterMinter() view returns (address)",
  "function configureMinter(address minter, uint256 minterAllowedAmount) external",
  "function mint(address to, uint256 amount) external returns (bool)",
];

const DAI_MINT_ABI = [
  "function wards(address) view returns (uint256)",
  "function mint(address usr, uint256 wad) external",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function header(msg: string) {
  console.log(`\n${"═".repeat(64)}\n  ${msg}\n${"═".repeat(64)}`);
}
function step(tag: string, msg: string) { console.log(`  ${tag.padEnd(16)} ${msg}`); }

function fmtToken(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, "0");
  return s.slice(0, -decimals) + "." + s.slice(-decimals);
}

function makePoolKey(a: string, b: string, fee: number, tickSpacing: number) {
  const [c0, c1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return { currency0: c0, currency1: c1, fee, tickSpacing, hooks: ethers.ZeroAddress };
}

/** PoolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks)) */
function poolId(key: ReturnType<typeof makePoolKey>): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24", "int24", "address"],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]
    )
  );
}

/**
 * Read pool's sqrtPriceX96 directly from PoolManager storage.
 * Slot = keccak256(abi.encode(poolId, POOLS_SLOT)) — the first word holds Slot0.
 * Bottom 160 bits = sqrtPriceX96; 0 means pool does not exist.
 */
async function readSqrtPrice(pid: string): Promise<bigint> {
  const stateSlot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "bytes32"],
      [pid, ethers.zeroPadValue(ethers.toBeHex(POOLS_SLOT), 32)]
    )
  );
  const raw = await ethers.provider.getStorage(POOL_MANAGER, stateSlot);
  return BigInt(raw) & ((1n << 160n) - 1n); // bottom 160 bits
}

/** Try common fee tiers; return the first V4 pool that has been initialised. */
async function findPool(tokenA: string, tokenB: string) {
  const tiers = [
    [100, 1], [500, 10], [3000, 60], [10000, 200],
  ] as [number, number][];

  for (const [fee, tickSpacing] of tiers) {
    const key = makePoolKey(tokenA, tokenB, fee, tickSpacing);
    const pid = poolId(key);
    const sqrtPrice = await readSqrtPrice(pid);
    if (sqrtPrice > 0n) {
      return { key, sqrtPrice, fee, tickSpacing };
    }
  }
  return null;
}

async function impersonate(address: string) {
  await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
  // Give the impersonated account ETH for gas
  await hre.network.provider.request({
    method: "hardhat_setBalance",
    params: [address, "0x" + (10n ** 20n).toString(16)],
  });
  return ethers.getSigner(address);
}
async function stopImpersonate(address: string) {
  await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [address] });
}

/** Mint USDC using the FiatToken masterMinter → configureMinter → mint pattern. */
async function mintUSDC(to: string, amount: bigint) {
  const usdcRead  = new ethers.Contract(USDC_ADDR, USDC_MINT_ABI, ethers.provider);
  const masterMinter = await usdcRead.masterMinter();
  const masterSigner = await impersonate(masterMinter);
  const usdcMaster = new ethers.Contract(USDC_ADDR, USDC_MINT_ABI, masterSigner);
  // Configure masterMinter itself as the minter, then mint directly to `to`
  await (await usdcMaster.configureMinter(masterMinter, amount)).wait();
  await (await usdcMaster.mint(to, amount)).wait();
  await stopImpersonate(masterMinter);
}

/**
 * Get DAI by impersonating a whale.
 * Tries several known large holders; uses the first with enough balance.
 */
async function getDAI(to: string, amount: bigint) {
  // Known large DAI holders on Base — checked at runtime
  const candidates = [
    "0x0B0A5886664376F59C351ba3f598C8A8B4D0A6f3",
    "0xBA12222222228d8Ba445958a75a0704d566BF2C8", // Balancer vault
    "0x3Fc91A3afd70395Cd496C647d5a6CC9D4B2b7FAD", // Uniswap UniversalRouter
    "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", // KyberSwap
    "0x1111111254EEB25477B68fb85Ed929f73A960582", // 1inch v5
  ];

  const dai = new ethers.Contract(DAI_ADDR, ERC20_ABI, ethers.provider);
  for (const c of candidates) {
    const bal = await dai.balanceOf(c);
    if (bal >= amount) {
      const whale = await impersonate(c);
      await (await dai.connect(whale).transfer(to, amount)).wait();
      await stopImpersonate(c);
      return c;
    }
  }

  // Fallback: try DAI's own mint function if it has a ward with access
  // (L2 DAI on Base typically has no public mint; if all else fails, skip)
  throw new Error("No DAI whale found — flow C will be skipped.");
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
  user: string, token: string, balance: bigint, nul: string, deadline: bigint
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

/** Full VeilSwap cycle: deposit → adminExecuteSwap → withdraw. Returns amountOut. */
async function runFlow(
  label: string,
  vault: VeilSwap,
  admin: Awaited<ReturnType<typeof ethers.getSigner>>,
  user: Awaited<ReturnType<typeof ethers.getSigner>>,
  tokenIn: string, tokenOut: string,
  amountIn: bigint,
  poolKey: ReturnType<typeof makePoolKey>,
  withdrawByUser: boolean
): Promise<bigint> {
  const VAULT = await vault.getAddress();
  const erc20In  = tokenIn  !== ETH_ADDR ? new ethers.Contract(tokenIn,  ERC20_ABI, ethers.provider) : null;
  const erc20Out = tokenOut !== ETH_ADDR ? new ethers.Contract(tokenOut, ERC20_ABI, ethers.provider) : null;
  const decimalsIn  = erc20In  ? Number(await erc20In.decimals())  : 18;
  const decimalsOut = erc20Out ? Number(await erc20Out.decimals()) : 18;

  header(`FLOW ${label}  —  ${user.address.slice(0,10)}…`);

  // 1. Deposit
  if (tokenIn === ETH_ADDR) {
    await (await vault.connect(user).deposit(ETH_ADDR, amountIn, { value: amountIn })).wait();
  } else {
    await (await erc20In!.connect(user).approve(VAULT, amountIn)).wait();
    await (await vault.connect(user).deposit(tokenIn, amountIn)).wait();
  }
  step("deposit :", `${fmtToken(amountIn, decimalsIn)} ${tokenIn === ETH_ADDR ? "ETH" : await erc20In!.symbol?.() ?? tokenIn.slice(0,10)}`);

  // 2. Build Merkle proof and set root
  const tree1 = StandardMerkleTree.of(
    [[user.address, tokenIn, amountIn.toString()]], ["address","address","uint256"]
  );
  const root1  = tree1.root as string;
  const proof1 = tree1.getProof(0) as string[];
  await (await vault.connect(admin).updateMerkleRoot(root1)).wait();

  // 3. Swap
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const tx = await vault.connect(admin).adminExecuteSwap(
    user.address, tokenIn, tokenOut, amountIn, 0n, poolKey, proof1, deadline
  );
  const receipt = await tx.wait();

  const swapLog = receipt?.logs
    .map(l => { try { return vault.interface.parseLog(l as any); } catch { return null; } })
    .find(e => e?.name === "SwapExecuted");
  const amountOut: bigint = swapLog?.args.amountOut ?? 0n;

  step("swap tx  :", tx.hash);
  step("in       :", `${fmtToken(amountIn,  decimalsIn)}  ${tokenIn  === ETH_ADDR ? "ETH" : "token"}`);
  step("out      :", `${fmtToken(amountOut, decimalsOut)} ${tokenOut === ETH_ADDR ? "ETH" : "token"}`);

  // 4. Update Merkle root (post-swap balance = tokenOut)
  const tree2 = StandardMerkleTree.of(
    [[user.address, tokenOut, amountOut.toString()]], ["address","address","uint256"]
  );
  const root2  = tree2.root as string;
  const proof2 = tree2.getProof(0) as string[];
  await (await vault.connect(admin).updateMerkleRoot(root2)).wait();

  // 5. Withdraw
  const nul      = nullifier(root2, user.address, tokenOut, amountOut);
  const dl       = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const sig      = await signWithdrawAuth(admin, vault, user.address, tokenOut, amountOut, nul, dl);

  const ethBefore  = tokenOut === ETH_ADDR ? await ethers.provider.getBalance(user.address) : 0n;
  const ercBefore  = erc20Out ? BigInt(await erc20Out.balanceOf(user.address)) : 0n;

  let wTx;
  if (withdrawByUser) {
    wTx = await vault.connect(user).withdraw(user.address, tokenOut, amountOut, proof2, dl, sig);
  } else {
    wTx = await vault.connect(admin).adminWithdraw(user.address, tokenOut, amountOut, proof2, dl, sig);
  }
  const wReceipt = await wTx.wait();

  const ethAfter  = tokenOut === ETH_ADDR ? await ethers.provider.getBalance(user.address) : 0n;
  const ercAfter  = erc20Out ? BigInt(await erc20Out.balanceOf(user.address)) : 0n;
  const received  = tokenOut === ETH_ADDR
    ? ethAfter - ethBefore + (wReceipt!.gasUsed * wReceipt!.gasPrice)  // add gas back for display
    : ercAfter - ercBefore;

  step("withdraw :", wTx.hash + (withdrawByUser ? " (user)" : " (admin)"));
  step("received :", `${fmtToken(received, decimalsOut)} ${tokenOut === ETH_ADDR ? "ETH" : "token"}  ✓`);
  step("nullifier:", `spent=${await vault.isNullifierSpent(nul)}`);

  return amountOut;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Verify fork
  const blockNumber = await ethers.provider.getBlockNumber();
  const pmCode = await ethers.provider.getCode(POOL_MANAGER);
  if (pmCode === "0x") throw new Error("No code at PoolManager — is FORK=1 set with Base RPC_URL?");
  console.log(`\n  Fork  : Base mainnet → hardhat`);
  console.log(`  Block : ${blockNumber.toLocaleString()}`);

  const [admin, alice, bob, charlie] = await ethers.getSigners();
  console.log(`  Admin : ${admin.address}`);

  // ── Discover real V4 pools ──────────────────────────────────────────────────
  header("DISCOVER REAL V4 POOLS");

  const usdcEth = await findPool(USDC_ADDR, ETH_ADDR);
  const daiEth  = await findPool(DAI_ADDR,  ETH_ADDR);

  if (!usdcEth) throw new Error("No USDC/ETH V4 pool found on Base. Try a different fork block.");

  step("USDC/ETH :", usdcEth
    ? `fee=${usdcEth.fee} tickSpacing=${usdcEth.tickSpacing}  sqrtPrice=${usdcEth.sqrtPrice}`
    : "NOT FOUND");
  step("DAI/ETH  :", daiEth
    ? `fee=${daiEth.fee}  tickSpacing=${daiEth.tickSpacing}  sqrtPrice=${daiEth.sqrtPrice}`
    : "NOT FOUND — Flow C will be skipped");

  // ── Deploy VeilSwap (against real PoolManager) ─────────────────────────────
  header("DEPLOY VeilSwap");

  const Vault = await ethers.getContractFactory("VeilSwap");
  const vault = (await Vault.deploy(admin.address, admin.address, POOL_MANAGER)) as VeilSwap;
  await vault.waitForDeployment();
  const VAULT = await vault.getAddress();
  step("VeilSwap :", VAULT);
  step("PM (real):", POOL_MANAGER);

  // ── Fund users with real tokens ────────────────────────────────────────────
  header("FUND USERS (mint / whale)");

  const USDC_AMOUNT = 200_000_000n; // 200 USDC  (6 dec)
  const DAI_AMOUNT  = 200n * 10n**18n; // 200 DAI   (18 dec)
  const ETH_AMOUNT  = ethers.parseEther("0.05");

  // USDC: mint directly via FiatToken masterMinter
  await mintUSDC(alice.address, USDC_AMOUNT);
  step("Alice USDC:", `${fmtToken(USDC_AMOUNT, 6)} USDC  (minted via masterMinter)`);
  step("Bob ETH   :", `${ethers.formatEther(ETH_AMOUNT)} ETH  (hardhat default)`);

  let daiAvailable = false;
  if (daiEth) {
    try {
      await getDAI(charlie.address, DAI_AMOUNT);
      step("Charlie DAI:", `${fmtToken(DAI_AMOUNT, 18)} DAI  (whale impersonation)`);
      daiAvailable = true;
    } catch (e: any) {
      step("Charlie DAI:", `SKIPPED — ${e.message}`);
    }
  }

  // ── FLOW A: Alice — USDC → ETH ─────────────────────────────────────────────
  const usdc = new ethers.Contract(USDC_ADDR, ERC20_ABI, alice);
  await (await usdc.approve(VAULT, USDC_AMOUNT)).wait();

  await runFlow(
    "A  Alice  USDC→ETH  (adminWithdraw)",
    vault, admin, alice,
    USDC_ADDR, ETH_ADDR,
    USDC_AMOUNT,
    usdcEth.key,
    false   // adminWithdraw
  );

  // ── FLOW B: Bob — ETH → USDC ───────────────────────────────────────────────
  await runFlow(
    "B  Bob    ETH→USDC  (self-withdraw)",
    vault, admin, bob,
    ETH_ADDR, USDC_ADDR,
    ETH_AMOUNT,
    usdcEth.key,
    true    // user self-withdraw
  );

  // ── FLOW C: Charlie — ETH → DAI (skipped if no pool / no whale) ───────────
  if (daiEth && daiAvailable) {
    const dai = new ethers.Contract(DAI_ADDR, ERC20_ABI, charlie);
    await runFlow(
      "C  Charlie ETH→DAI  (self-withdraw)",
      vault, admin, charlie,
      ETH_ADDR, DAI_ADDR,
      ETH_AMOUNT,
      daiEth.key,
      true
    );
  } else {
    header("FLOW C  — SKIPPED (no DAI/ETH V4 pool or no DAI whale)");
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  header("DONE");
  console.log(`  All swaps used the real Uniswap V4 PoolManager at block ${blockNumber.toLocaleString()}.`);
  console.log(`  Outputs reflect actual on-chain prices and LP fees.\n`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
