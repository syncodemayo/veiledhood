/// <reference types="@nomicfoundation/hardhat-chai-matchers" />

import { expect } from "chai";
import hre from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { VeilSwap } from "../typechain-types/contracts/VeilSwap";
import type { MockUSDC } from "../typechain-types/contracts/mock/MockUSDC";
import type { MockUniswapV4PoolManager } from "../typechain-types/contracts/mock/MockUniswapV4PoolManager";

const { ethers } = hre as any;

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeNullifier(root: string, user: string, token: string, balance: bigint): string {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  return ethers.keccak256(
    abi.encode(["bytes32", "address", "address", "uint256"], [root, user, token, balance])
  );
}

async function signWithdrawAuth(params: {
  signer: HardhatEthersSigner;
  vault: VeilSwap;
  user: string;
  token: string;
  balance: bigint;
  nullifier: string;
  deadline: bigint;
}): Promise<string> {
  const { chainId } = await ethers.provider.getNetwork();
  return params.signer.signTypedData(
    { name: "VeilSwap", version: "1", chainId, verifyingContract: await params.vault.getAddress() },
    {
      WithdrawAuth: [
        { name: "user", type: "address" },
        { name: "token", type: "address" },
        { name: "balance", type: "uint256" },
        { name: "nullifier", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    },
    { user: params.user, token: params.token, balance: params.balance, nullifier: params.nullifier, deadline: params.deadline }
  );
}

type PoolKeyStruct = {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
};

function makePoolKey(tokenA: string, tokenB: string, fee = 3000, tickSpacing = 60): PoolKeyStruct {
  const [currency0, currency1] =
    tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
  return { currency0, currency1, fee, tickSpacing, hooks: ethers.ZeroAddress };
}

// ─── Core ────────────────────────────────────────────────────────────────────

describe("VeilSwap", function () {
  let admin: HardhatEthersSigner;
  let withdrawSigner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let vault: VeilSwap;
  let usdc: MockUSDC;
  let dai: MockUSDC;
  let mockPoolManager: MockUniswapV4PoolManager;

  const MOCK_AMOUNT_OUT = 900_000n;

  beforeEach(async () => {
    [admin, withdrawSigner, alice, bob] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockUSDC");
    usdc = (await Mock.deploy(100_000_000n)) as MockUSDC;
    await usdc.waitForDeployment();

    dai = (await Mock.deploy(100_000_000n)) as MockUSDC;
    await dai.waitForDeployment();

    const PM = await ethers.getContractFactory("MockUniswapV4PoolManager");
    mockPoolManager = (await PM.deploy(MOCK_AMOUNT_OUT)) as MockUniswapV4PoolManager;
    await mockPoolManager.waitForDeployment();

    const Vault = await ethers.getContractFactory("VeilSwap");
    vault = (await Vault.deploy(
      await admin.getAddress(),
      await withdrawSigner.getAddress(),
      await mockPoolManager.getAddress()
    )) as VeilSwap;
    await vault.waitForDeployment();
  });

  // ── Constructor ────────────────────────────────────────────────────────────

  it("stores poolManager immutable on deployment", async () => {
    expect(await vault.poolManager()).to.equal(await mockPoolManager.getAddress());
  });

  it("constructor reverts when any address argument is zero", async () => {
    const Vault = await ethers.getContractFactory("VeilSwap");
    const pmAddr = await mockPoolManager.getAddress();

    await expect(
      Vault.deploy(ethers.ZeroAddress, await withdrawSigner.getAddress(), pmAddr)
    ).to.be.revertedWithCustomError(vault, "ZeroAddress");

    await expect(
      Vault.deploy(await admin.getAddress(), ethers.ZeroAddress, pmAddr)
    ).to.be.revertedWithCustomError(vault, "ZeroAddress");

    await expect(
      Vault.deploy(await admin.getAddress(), await withdrawSigner.getAddress(), ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(vault, "ZeroAddress");
  });

  // ── Deposit ────────────────────────────────────────────────────────────────

  it("accepts ETH deposit and emits Deposited", async () => {
    const amount = ethers.parseEther("1");
    await expect(
      vault.connect(alice).deposit(ethers.ZeroAddress, amount, { value: amount })
    )
      .to.emit(vault, "Deposited")
      .withArgs(await alice.getAddress(), ethers.ZeroAddress, amount);
  });

  it("accepts ERC-20 deposit and emits Deposited", async () => {
    const amount = 500_000n;
    await usdc.transfer(await alice.getAddress(), amount);
    await usdc.connect(alice).approve(await vault.getAddress(), amount);

    await expect(vault.connect(alice).deposit(await usdc.getAddress(), amount))
      .to.emit(vault, "Deposited")
      .withArgs(await alice.getAddress(), await usdc.getAddress(), amount);
  });

  it("receive() silently accepts ETH (required for PoolManager Token→ETH callbacks)", async () => {
    await expect(
      alice.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther("0.1") })
    ).to.not.be.reverted;
  });

  // ── Merkle root ────────────────────────────────────────────────────────────

  it("only admin can update Merkle root; zero root reverts", async () => {
    const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
    await expect(vault.connect(alice).updateMerkleRoot(root)).to.be.revertedWithCustomError(vault, "OnlyAdmin");
    await expect(vault.connect(admin).updateMerkleRoot(ethers.ZeroHash)).to.be.revertedWithCustomError(vault, "ZeroAddress");
    await expect(vault.connect(admin).updateMerkleRoot(root))
      .to.emit(vault, "MerkleRootUpdated")
      .withArgs(root);
    expect(await vault.getMerkleRoot()).to.equal(root);
  });

  // ── adminExecuteSwap ───────────────────────────────────────────────────────

  it("adminExecuteSwap Token→Token: consumes leaf, routes through pool manager, credits tokenOut reserves, emits SwapExecuted", async () => {
    const amountIn = 1_000_000n;
    await usdc.transfer(await alice.getAddress(), amountIn);
    await usdc.connect(alice).approve(await vault.getAddress(), amountIn);
    await vault.connect(alice).deposit(await usdc.getAddress(), amountIn);

    // Pre-fund mock pool manager with the output token
    await dai.transfer(await mockPoolManager.getAddress(), MOCK_AMOUNT_OUT);

    const entries: [string, string, string][] = [
      [await alice.getAddress(), await usdc.getAddress(), amountIn.toString()],
    ];
    const tree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    const root = tree.root as string;
    const proof = tree.getProof(0) as string[];
    await vault.connect(admin).updateMerkleRoot(root);

    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const poolKey = makePoolKey(await usdc.getAddress(), await dai.getAddress());

    await expect(
      vault.connect(admin).adminExecuteSwap(
        await alice.getAddress(),
        await usdc.getAddress(),
        await dai.getAddress(),
        amountIn,
        0n,
        poolKey,
        proof,
        deadline
      )
    )
      .to.emit(vault, "SwapExecuted")
      .withArgs(
        await alice.getAddress(),
        await usdc.getAddress(),
        await dai.getAddress(),
        amountIn,
        MOCK_AMOUNT_OUT,
        ethers.ZeroHash
      );

    // tokenIn reserves are now 0 — second call reverts
    await expect(
      vault.connect(admin).adminExecuteSwap(
        await alice.getAddress(),
        await usdc.getAddress(),
        await dai.getAddress(),
        amountIn,
        0n,
        poolKey,
        proof,
        deadline
      )
    ).to.be.revertedWithCustomError(vault, "InsufficientReserves");
  });

  it("adminExecuteSwap ETH→Token: drains ETH reserves and credits tokenOut", async () => {
    const amountIn = ethers.parseEther("1");
    await vault.connect(alice).deposit(ethers.ZeroAddress, amountIn, { value: amountIn });

    // Pre-fund mock pool manager with the output token
    await dai.transfer(await mockPoolManager.getAddress(), MOCK_AMOUNT_OUT);

    const entries: [string, string, string][] = [
      [await alice.getAddress(), ethers.ZeroAddress, amountIn.toString()],
    ];
    const tree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    const root = tree.root as string;
    const proof = tree.getProof(0) as string[];
    await vault.connect(admin).updateMerkleRoot(root);

    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const poolKey = makePoolKey(ethers.ZeroAddress, await dai.getAddress());

    await expect(
      vault.connect(admin).adminExecuteSwap(
        await alice.getAddress(),
        ethers.ZeroAddress,
        await dai.getAddress(),
        amountIn,
        0n,
        poolKey,
        proof,
        deadline
      )
    )
      .to.emit(vault, "SwapExecuted")
      .withArgs(
        await alice.getAddress(),
        ethers.ZeroAddress,
        await dai.getAddress(),
        amountIn,
        MOCK_AMOUNT_OUT,
        ethers.ZeroHash
      );
  });

  it("adminExecuteSwap Token→ETH: drains tokenIn reserves and credits ETH reserves", async () => {
    const amountIn = 1_000_000n;
    const ethOut = ethers.parseEther("0.5");
    await mockPoolManager.setFixedAmountOut(ethOut);

    await usdc.transfer(await alice.getAddress(), amountIn);
    await usdc.connect(alice).approve(await vault.getAddress(), amountIn);
    await vault.connect(alice).deposit(await usdc.getAddress(), amountIn);

    // Pre-fund mock pool manager with ETH so it can return ETH to VeilSwap
    await admin.sendTransaction({ to: await mockPoolManager.getAddress(), value: ethOut });

    const entries: [string, string, string][] = [
      [await alice.getAddress(), await usdc.getAddress(), amountIn.toString()],
    ];
    const tree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    const root = tree.root as string;
    const proof = tree.getProof(0) as string[];
    await vault.connect(admin).updateMerkleRoot(root);

    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const poolKey = makePoolKey(await usdc.getAddress(), ethers.ZeroAddress);

    await expect(
      vault.connect(admin).adminExecuteSwap(
        await alice.getAddress(),
        await usdc.getAddress(),
        ethers.ZeroAddress,
        amountIn,
        0n,
        poolKey,
        proof,
        deadline
      )
    )
      .to.emit(vault, "SwapExecuted")
      .withArgs(
        await alice.getAddress(),
        await usdc.getAddress(),
        ethers.ZeroAddress,
        amountIn,
        ethOut,
        ethers.ZeroHash
      );
  });

  // ── adminWithdraw ──────────────────────────────────────────────────────────

  it("adminWithdraw ERC-20: pays user and prevents replay", async () => {
    const balance = 777_000n;
    await usdc.transfer(await alice.getAddress(), balance);
    await usdc.connect(alice).approve(await vault.getAddress(), balance);
    await vault.connect(alice).deposit(await usdc.getAddress(), balance);

    const entries: [string, string, string][] = [
      [await alice.getAddress(), await usdc.getAddress(), balance.toString()],
    ];
    const tree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    const root = tree.root as string;
    const proof = tree.getProof(0) as string[];
    await vault.connect(admin).updateMerkleRoot(root);

    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const nullifier = computeNullifier(root, await alice.getAddress(), await usdc.getAddress(), balance);
    const sig = await signWithdrawAuth({
      signer: withdrawSigner,
      vault,
      user: await alice.getAddress(),
      token: await usdc.getAddress(),
      balance,
      nullifier,
      deadline: BigInt(deadline),
    });

    const balBefore = await usdc.balanceOf(await alice.getAddress());
    await expect(
      vault.connect(admin).adminWithdraw(await alice.getAddress(), await usdc.getAddress(), balance, proof, deadline, sig)
    )
      .to.emit(vault, "AdminWithdrawal")
      .withArgs(await alice.getAddress(), await usdc.getAddress(), balance, nullifier);

    expect(await usdc.balanceOf(await alice.getAddress())).to.equal(balBefore + balance);

    await expect(
      vault.connect(admin).adminWithdraw(await alice.getAddress(), await usdc.getAddress(), balance, proof, deadline, sig)
    ).to.be.revertedWithCustomError(vault, "NullifierAlreadyUsed");
  });

  it("adminWithdraw ETH: transfers native ETH to user", async () => {
    const amount = ethers.parseEther("2");
    await vault.connect(alice).deposit(ethers.ZeroAddress, amount, { value: amount });

    const entries: [string, string, string][] = [
      [await alice.getAddress(), ethers.ZeroAddress, amount.toString()],
    ];
    const tree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    const root = tree.root as string;
    const proof = tree.getProof(0) as string[];
    await vault.connect(admin).updateMerkleRoot(root);

    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const nullifier = computeNullifier(root, await alice.getAddress(), ethers.ZeroAddress, amount);
    const sig = await signWithdrawAuth({
      signer: withdrawSigner,
      vault,
      user: await alice.getAddress(),
      token: ethers.ZeroAddress,
      balance: amount,
      nullifier,
      deadline: BigInt(deadline),
    });

    const ethBefore = await ethers.provider.getBalance(await alice.getAddress());
    await (
      await vault.connect(admin).adminWithdraw(await alice.getAddress(), ethers.ZeroAddress, amount, proof, deadline, sig)
    ).wait();
    const ethAfter = await ethers.provider.getBalance(await alice.getAddress());
    expect(ethAfter - ethBefore).to.equal(amount);
  });

  // ── withdraw (user-initiated) ──────────────────────────────────────────────

  it("withdraw: user can self-withdraw ERC-20 (emits UserWithdrawal)", async () => {
    const balance = 333_000n;
    await usdc.transfer(await alice.getAddress(), balance);
    await usdc.connect(alice).approve(await vault.getAddress(), balance);
    await vault.connect(alice).deposit(await usdc.getAddress(), balance);

    const entries: [string, string, string][] = [
      [await alice.getAddress(), await usdc.getAddress(), balance.toString()],
    ];
    const tree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    const root = tree.root as string;
    const proof = tree.getProof(0) as string[];
    await vault.connect(admin).updateMerkleRoot(root);

    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const nullifier = computeNullifier(root, await alice.getAddress(), await usdc.getAddress(), balance);
    const sig = await signWithdrawAuth({
      signer: withdrawSigner,
      vault,
      user: await alice.getAddress(),
      token: await usdc.getAddress(),
      balance,
      nullifier,
      deadline: BigInt(deadline),
    });

    await expect(
      vault.connect(alice).withdraw(await alice.getAddress(), await usdc.getAddress(), balance, proof, deadline, sig)
    )
      .to.emit(vault, "UserWithdrawal")
      .withArgs(await alice.getAddress(), await usdc.getAddress(), balance, nullifier);
  });

  it("withdraw reverts when caller is not user (NotSelf)", async () => {
    const balance = 100n;
    await usdc.transfer(await alice.getAddress(), balance);
    await usdc.connect(alice).approve(await vault.getAddress(), balance);
    await vault.connect(alice).deposit(await usdc.getAddress(), balance);

    const entries: [string, string, string][] = [
      [await alice.getAddress(), await usdc.getAddress(), balance.toString()],
    ];
    const tree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    const root = tree.root as string;
    const proof = tree.getProof(0) as string[];
    await vault.connect(admin).updateMerkleRoot(root);

    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const nullifier = computeNullifier(root, await alice.getAddress(), await usdc.getAddress(), balance);
    const sig = await signWithdrawAuth({
      signer: withdrawSigner,
      vault,
      user: await alice.getAddress(),
      token: await usdc.getAddress(),
      balance,
      nullifier,
      deadline: BigInt(deadline),
    });

    await expect(
      vault.connect(bob).withdraw(await alice.getAddress(), await usdc.getAddress(), balance, proof, deadline, sig)
    ).to.be.revertedWithCustomError(vault, "NotSelf");
  });

  // ── View helpers ───────────────────────────────────────────────────────────

  it("verifyBalance: returns false before root is set, false for wrong balance, true for valid leaf", async () => {
    const balance = 123_456n;
    const entries: [string, string, string][] = [
      [await alice.getAddress(), await usdc.getAddress(), balance.toString()],
    ];
    const tree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    const root = tree.root as string;
    const proof = tree.getProof(0) as string[];

    expect(await vault.getMerkleRoot()).to.equal(ethers.ZeroHash);
    expect(await vault.verifyBalance(await alice.getAddress(), await usdc.getAddress(), balance, proof)).to.equal(false);

    await vault.connect(admin).updateMerkleRoot(root);
    expect(await vault.verifyBalance(await alice.getAddress(), await usdc.getAddress(), balance + 1n, proof)).to.equal(false);
    expect(await vault.verifyBalance(await alice.getAddress(), await usdc.getAddress(), balance, proof)).to.equal(true);
  });
});

// ─── Edge Cases ───────────────────────────────────────────────────────────────

describe("VeilSwap / edge cases", function () {
  let admin: HardhatEthersSigner;
  let withdrawSigner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;

  let vault: VeilSwap;
  let usdc: MockUSDC;
  let mockPoolManager: MockUniswapV4PoolManager;

  beforeEach(async () => {
    [admin, withdrawSigner, alice] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockUSDC");
    usdc = (await Mock.deploy(100_000_000n)) as MockUSDC;
    await usdc.waitForDeployment();

    const PM = await ethers.getContractFactory("MockUniswapV4PoolManager");
    mockPoolManager = (await PM.deploy(0n)) as MockUniswapV4PoolManager;
    await mockPoolManager.waitForDeployment();

    const Vault = await ethers.getContractFactory("VeilSwap");
    vault = (await Vault.deploy(
      await admin.getAddress(),
      await withdrawSigner.getAddress(),
      await mockPoolManager.getAddress()
    )) as VeilSwap;
    await vault.waitForDeployment();
  });

  // ── deposit errors ─────────────────────────────────────────────────────────

  it("deposit: rejects zero amount, ETH msg.value mismatch, ERC-20 with msg.value", async () => {
    await expect(vault.connect(alice).deposit(ethers.ZeroAddress, 0n, { value: 0n }))
      .to.be.revertedWithCustomError(vault, "ZeroAmount");

    await expect(vault.connect(alice).deposit(ethers.ZeroAddress, 10n, { value: 9n }))
      .to.be.revertedWithCustomError(vault, "MsgValueMismatch");

    await usdc.transfer(await alice.getAddress(), 1000n);
    await expect(vault.connect(alice).deposit(await usdc.getAddress(), 100n, { value: 1n }))
      .to.be.revertedWithCustomError(vault, "MsgValueMismatch");
  });

  // ── adminExecuteSwap errors ────────────────────────────────────────────────

  it("adminExecuteSwap: OnlyAdmin reverts for non-admin caller", async () => {
    const dummyKey = makePoolKey(await usdc.getAddress(), ethers.ZeroAddress);
    await expect(
      vault.connect(alice).adminExecuteSwap(
        await alice.getAddress(), await usdc.getAddress(), ethers.ZeroAddress,
        1n, 0n, dummyKey, [], 9999999999
      )
    ).to.be.revertedWithCustomError(vault, "OnlyAdmin");
  });

  it("adminExecuteSwap: ZeroAddress for user", async () => {
    const dummyKey = makePoolKey(await usdc.getAddress(), ethers.ZeroAddress);
    await expect(
      vault.connect(admin).adminExecuteSwap(
        ethers.ZeroAddress, await usdc.getAddress(), ethers.ZeroAddress,
        1n, 0n, dummyKey, [], 9999999999
      )
    ).to.be.revertedWithCustomError(vault, "ZeroAddress");
  });

  it("adminExecuteSwap: ZeroAmount for amountIn", async () => {
    const dummyKey = makePoolKey(await usdc.getAddress(), ethers.ZeroAddress);
    await expect(
      vault.connect(admin).adminExecuteSwap(
        await alice.getAddress(), await usdc.getAddress(), ethers.ZeroAddress,
        0n, 0n, dummyKey, [], 9999999999
      )
    ).to.be.revertedWithCustomError(vault, "ZeroAmount");
  });

  it("adminExecuteSwap: WithdrawExpired when deadline is in the past", async () => {
    const pastDeadline = (await ethers.provider.getBlock("latest"))!.timestamp - 1;
    const dummyKey = makePoolKey(await usdc.getAddress(), ethers.ZeroAddress);
    await expect(
      vault.connect(admin).adminExecuteSwap(
        await alice.getAddress(), await usdc.getAddress(), ethers.ZeroAddress,
        1n, 0n, dummyKey, [], pastDeadline
      )
    ).to.be.revertedWithCustomError(vault, "WithdrawExpired");
  });

  it("adminExecuteSwap: InvalidPath when PoolKey currencies do not match tokenIn/tokenOut", async () => {
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const rand1 = ethers.Wallet.createRandom().address;
    const rand2 = ethers.Wallet.createRandom().address;
    const wrongKey: PoolKeyStruct = {
      currency0: rand1.toLowerCase() < rand2.toLowerCase() ? rand1 : rand2,
      currency1: rand1.toLowerCase() < rand2.toLowerCase() ? rand2 : rand1,
      fee: 3000,
      tickSpacing: 60,
      hooks: ethers.ZeroAddress,
    };

    // Neither currency matches tokenIn (usdc)
    await expect(
      vault.connect(admin).adminExecuteSwap(
        await alice.getAddress(), await usdc.getAddress(), ethers.ZeroAddress,
        1n, 0n, wrongKey, [], deadline
      )
    ).to.be.revertedWithCustomError(vault, "InvalidPath");

    // currency0 = address(0) matches tokenIn=ETH, but currency1 = usdc doesn't match tokenOut=rand
    const randOut = ethers.Wallet.createRandom().address;
    const badOutKey: PoolKeyStruct = {
      currency0: ethers.ZeroAddress,
      currency1: await usdc.getAddress(),
      fee: 3000,
      tickSpacing: 60,
      hooks: ethers.ZeroAddress,
    };
    await expect(
      vault.connect(admin).adminExecuteSwap(
        await alice.getAddress(), ethers.ZeroAddress, randOut,
        1n, 0n, badOutKey, [], deadline
      )
    ).to.be.revertedWithCustomError(vault, "InvalidPath");
  });

  it("adminExecuteSwap: InvalidMerkleProof with bad proof", async () => {
    const balance = 1_000_000n;
    await usdc.transfer(await alice.getAddress(), balance);
    await usdc.connect(alice).approve(await vault.getAddress(), balance);
    await vault.connect(alice).deposit(await usdc.getAddress(), balance);

    const Mock = await ethers.getContractFactory("MockUSDC");
    const tokenOut = (await Mock.deploy(100_000_000n)) as MockUSDC;
    await tokenOut.waitForDeployment();

    const entries: [string, string, string][] = [
      [await alice.getAddress(), await usdc.getAddress(), balance.toString()],
    ];
    const tree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    const root = tree.root as string;
    const proof = tree.getProof(0) as string[];
    await vault.connect(admin).updateMerkleRoot(root);

    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const poolKey = makePoolKey(await usdc.getAddress(), await tokenOut.getAddress());

    // wrong amountIn breaks the proof
    await expect(
      vault.connect(admin).adminExecuteSwap(
        await alice.getAddress(), await usdc.getAddress(), await tokenOut.getAddress(),
        balance + 1n, 0n, poolKey, proof, deadline
      )
    ).to.be.revertedWithCustomError(vault, "InvalidMerkleProof");
  });

  it("adminExecuteSwap: SlippageExceeded when amountOut < amountOutMin", async () => {
    const balance = 1_000_000n;
    await usdc.transfer(await alice.getAddress(), balance);
    await usdc.connect(alice).approve(await vault.getAddress(), balance);
    await vault.connect(alice).deposit(await usdc.getAddress(), balance);

    const Mock = await ethers.getContractFactory("MockUSDC");
    const tokenOut = (await Mock.deploy(100_000_000n)) as MockUSDC;
    await tokenOut.waitForDeployment();

    // Mock returns 100 tokens; amountOutMin = 101 → SlippageExceeded
    await mockPoolManager.setFixedAmountOut(100n);

    const entries: [string, string, string][] = [
      [await alice.getAddress(), await usdc.getAddress(), balance.toString()],
    ];
    const tree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    const root = tree.root as string;
    const proof = tree.getProof(0) as string[];
    await vault.connect(admin).updateMerkleRoot(root);

    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const poolKey = makePoolKey(await usdc.getAddress(), await tokenOut.getAddress());

    await expect(
      vault.connect(admin).adminExecuteSwap(
        await alice.getAddress(), await usdc.getAddress(), await tokenOut.getAddress(),
        balance, 101n, poolKey, proof, deadline
      )
    ).to.be.revertedWithCustomError(vault, "SlippageExceeded");
  });

  it("unlockCallback: reverts if called by non-PoolManager", async () => {
    await expect(
      vault.connect(alice).unlockCallback("0x")
    ).to.be.revertedWithCustomError(vault, "NotPoolManager");
  });

  it("adminExecuteSwap: InsufficientReserves when vault balance is less than committed amountIn", async () => {
    // Deposit only 500, but commit 1000 in the tree
    const deposited = 500_000n;
    const committed = 1_000_000n;
    await usdc.transfer(await alice.getAddress(), deposited);
    await usdc.connect(alice).approve(await vault.getAddress(), deposited);
    await vault.connect(alice).deposit(await usdc.getAddress(), deposited);

    const Mock = await ethers.getContractFactory("MockUSDC");
    const tokenOut = (await Mock.deploy(100_000_000n)) as MockUSDC;
    await tokenOut.waitForDeployment();

    const entries: [string, string, string][] = [
      [await alice.getAddress(), await usdc.getAddress(), committed.toString()],
    ];
    const tree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    const root = tree.root as string;
    const proof = tree.getProof(0) as string[];
    await vault.connect(admin).updateMerkleRoot(root);

    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const poolKey = makePoolKey(await usdc.getAddress(), await tokenOut.getAddress());

    await expect(
      vault.connect(admin).adminExecuteSwap(
        await alice.getAddress(), await usdc.getAddress(), await tokenOut.getAddress(),
        committed, 0n, poolKey, proof, deadline
      )
    ).to.be.revertedWithCustomError(vault, "InsufficientReserves");
  });

  // ── adminWithdraw errors ───────────────────────────────────────────────────

  it("adminWithdraw: bad proof, bad sig, expired deadline, InsufficientReserves all revert", async () => {
    const deposited = 1_000n;
    const committed = 2_000n; // larger than deposited → InsufficientReserves
    await usdc.transfer(await alice.getAddress(), deposited);
    await usdc.connect(alice).approve(await vault.getAddress(), deposited);
    await vault.connect(alice).deposit(await usdc.getAddress(), deposited);

    const entries: [string, string, string][] = [
      [await alice.getAddress(), await usdc.getAddress(), committed.toString()],
    ];
    const tree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    const root = tree.root as string;
    const proof = tree.getProof(0) as string[];
    await vault.connect(admin).updateMerkleRoot(root);

    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const nullifier = computeNullifier(root, await alice.getAddress(), await usdc.getAddress(), committed);
    const sig = await signWithdrawAuth({
      signer: withdrawSigner,
      vault,
      user: await alice.getAddress(),
      token: await usdc.getAddress(),
      balance: committed,
      nullifier,
      deadline: BigInt(deadline),
    });

    // InsufficientReserves
    await expect(
      vault.connect(admin).adminWithdraw(await alice.getAddress(), await usdc.getAddress(), committed, proof, deadline, sig)
    ).to.be.revertedWithCustomError(vault, "InsufficientReserves");

    // InvalidMerkleProof — wrong balance
    await expect(
      vault.connect(admin).adminWithdraw(await alice.getAddress(), await usdc.getAddress(), 123n, proof, deadline, sig)
    ).to.be.revertedWithCustomError(vault, "InvalidMerkleProof");

    // WithdrawExpired
    await expect(
      vault.connect(admin).adminWithdraw(
        await alice.getAddress(), await usdc.getAddress(), committed, proof,
        (await ethers.provider.getBlock("latest"))!.timestamp - 1, sig
      )
    ).to.be.revertedWithCustomError(vault, "WithdrawExpired");

    // InvalidSignature — signed by admin instead of withdrawSigner
    const badSig = await signWithdrawAuth({
      signer: admin,
      vault,
      user: await alice.getAddress(),
      token: await usdc.getAddress(),
      balance: committed,
      nullifier,
      deadline: BigInt(deadline),
    });
    await expect(
      vault.connect(admin).adminWithdraw(await alice.getAddress(), await usdc.getAddress(), committed, proof, deadline, badSig)
    ).to.be.revertedWithCustomError(vault, "InvalidSignature");
  });

  // ── Admin controls ─────────────────────────────────────────────────────────

  it("non-admin cannot call onlyAdmin functions", async () => {
    const root = ethers.keccak256(ethers.toUtf8Bytes("r"));
    await expect(vault.connect(alice).updateMerkleRoot(root)).to.be.revertedWithCustomError(vault, "OnlyAdmin");
    await expect(
      vault.connect(alice).adminWithdraw(await alice.getAddress(), await usdc.getAddress(), 1n, [], 9999999999, "0x")
    ).to.be.revertedWithCustomError(vault, "OnlyAdmin");

    const dummyKey = makePoolKey(await usdc.getAddress(), ethers.ZeroAddress);
    await expect(
      vault.connect(alice).adminExecuteSwap(
        await alice.getAddress(), await usdc.getAddress(), ethers.ZeroAddress,
        1n, 0n, dummyKey, [], 9999999999
      )
    ).to.be.revertedWithCustomError(vault, "OnlyAdmin");

    await expect(vault.connect(alice).transferAdmin(await alice.getAddress())).to.be.revertedWithCustomError(vault, "OnlyAdmin");
    await expect(vault.connect(alice).setWithdrawSigner(await alice.getAddress())).to.be.revertedWithCustomError(vault, "OnlyAdmin");
    await expect(vault.connect(alice).rescueToken(await usdc.getAddress(), await alice.getAddress())).to.be.revertedWithCustomError(vault, "OnlyAdmin");
  });

  it("transferAdmin: changes admin, emits AdminTransferred, old admin loses access", async () => {
    await expect(vault.connect(admin).transferAdmin(await alice.getAddress()))
      .to.emit(vault, "AdminTransferred")
      .withArgs(await admin.getAddress(), await alice.getAddress());

    // Old admin can no longer call admin functions
    await expect(
      vault.connect(admin).updateMerkleRoot(ethers.keccak256(ethers.toUtf8Bytes("x")))
    ).to.be.revertedWithCustomError(vault, "OnlyAdmin");

    // New admin can
    await expect(
      vault.connect(alice).updateMerkleRoot(ethers.keccak256(ethers.toUtf8Bytes("x")))
    ).to.not.be.reverted;
  });

  it("transferAdmin: reverts on zero address", async () => {
    await expect(vault.connect(admin).transferAdmin(ethers.ZeroAddress)).to.be.revertedWithCustomError(vault, "ZeroAddress");
  });

  it("setWithdrawSigner: updates signer, old signer's signatures become invalid", async () => {
    const balance = 1_000n;
    await usdc.transfer(await alice.getAddress(), balance);
    await usdc.connect(alice).approve(await vault.getAddress(), balance);
    await vault.connect(alice).deposit(await usdc.getAddress(), balance);

    const entries: [string, string, string][] = [
      [await alice.getAddress(), await usdc.getAddress(), balance.toString()],
    ];
    const tree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    const root = tree.root as string;
    const proof = tree.getProof(0) as string[];
    await vault.connect(admin).updateMerkleRoot(root);

    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const nullifier = computeNullifier(root, await alice.getAddress(), await usdc.getAddress(), balance);
    const oldSig = await signWithdrawAuth({
      signer: withdrawSigner,
      vault,
      user: await alice.getAddress(),
      token: await usdc.getAddress(),
      balance,
      nullifier,
      deadline: BigInt(deadline),
    });

    // Rotate the signer to alice (who didn't sign)
    await expect(vault.connect(admin).setWithdrawSigner(await alice.getAddress()))
      .to.emit(vault, "WithdrawSignerUpdated")
      .withArgs(await alice.getAddress());

    // Old signature is now invalid
    await expect(
      vault.connect(admin).adminWithdraw(await alice.getAddress(), await usdc.getAddress(), balance, proof, deadline, oldSig)
    ).to.be.revertedWithCustomError(vault, "InvalidSignature");
  });

  // ── rescueToken ────────────────────────────────────────────────────────────

  it("rescueToken: sweeps ERC-20 surplus and reverts when no surplus", async () => {
    const deposited = 1_000n;
    await usdc.transfer(await alice.getAddress(), deposited);
    await usdc.connect(alice).approve(await vault.getAddress(), deposited);
    await vault.connect(alice).deposit(await usdc.getAddress(), deposited);

    await expect(
      vault.connect(admin).rescueToken(await usdc.getAddress(), await admin.getAddress())
    ).to.be.revertedWithCustomError(vault, "NoSurplus");

    const surplus = 500n;
    await usdc.transfer(await vault.getAddress(), surplus);

    const balBefore = await usdc.balanceOf(await admin.getAddress());
    await vault.connect(admin).rescueToken(await usdc.getAddress(), await admin.getAddress());
    expect(await usdc.balanceOf(await admin.getAddress())).to.equal(balBefore + surplus);
  });

  it("rescueToken: sweeps ETH surplus", async () => {
    const deposited = ethers.parseEther("1");
    await vault.connect(alice).deposit(ethers.ZeroAddress, deposited, { value: deposited });

    // Directly send extra ETH to vault (bypasses deposit → no reserves entry)
    const surplus = ethers.parseEther("0.5");
    await alice.sendTransaction({ to: await vault.getAddress(), value: surplus });

    const balBefore = await ethers.provider.getBalance(await admin.getAddress());
    const receipt = await (
      await vault.connect(admin).rescueToken(ethers.ZeroAddress, await admin.getAddress())
    ).wait();
    const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
    const balAfter = await ethers.provider.getBalance(await admin.getAddress());
    expect(balAfter - balBefore + gasUsed).to.equal(surplus);
  });

  it("rescueToken: reverts with ZeroAddress recipient", async () => {
    await expect(
      vault.connect(admin).rescueToken(await usdc.getAddress(), ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(vault, "ZeroAddress");
  });
});
