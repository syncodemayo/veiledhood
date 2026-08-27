/// <reference types="@nomicfoundation/hardhat-chai-matchers" />

import { expect } from "chai";
import hre from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { Veiledhood } from "../typechain-types/contracts/Veiledhood";
import type { MockUSDC } from "../typechain-types/contracts/mock/MockUSDC";

const { ethers } = hre as any;

function computeNullifier(root: string, user: string, token: string, balance: bigint): string {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const encoded = abi.encode(["bytes32", "address", "address", "uint256"], [root, user, token, balance]);
  return ethers.keccak256(encoded);
}

async function signWithdrawAuth(params: {
  signer: HardhatEthersSigner;
  vault: Veiledhood;
  user: string;
  token: string;
  balance: bigint;
  nullifier: string;
  deadline: bigint;
}): Promise<string> {
  const { chainId } = await ethers.provider.getNetwork();
  const domain = {
    name: "Veiledhood",
    version: "1",
    chainId,
    verifyingContract: await params.vault.getAddress(),
  };
  const types = {
    WithdrawAuth: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "nullifier", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const value = {
    user: params.user,
    token: params.token,
    balance: params.balance,
    nullifier: params.nullifier,
    deadline: params.deadline,
  };
  return params.signer.signTypedData(domain, types, value);
}

describe("Veiledhood", function () {
  let admin: HardhatEthersSigner;
  let withdrawSigner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;

  let vault: Veiledhood;

  beforeEach(async () => {
    [admin, withdrawSigner, alice] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("Veiledhood");
    vault = (await Vault.deploy(await admin.getAddress(), await withdrawSigner.getAddress())) as Veiledhood;
    await vault.waitForDeployment();
  });

  it("accepts ETH deposit via deposit() and rejects direct receive()", async () => {
    const amount = 123n;
    await expect(
      vault.connect(alice).deposit(ethers.ZeroAddress, amount, { value: amount })
    ).to.emit(vault, "Deposited").withArgs(await alice.getAddress(), ethers.ZeroAddress, amount);

    await expect(
      alice.sendTransaction({ to: await vault.getAddress(), value: 1n })
    ).to.be.revertedWith("Use deposit()");
  });

  it("accepts ERC-20 deposit via deposit()", async () => {
    const Mock = await ethers.getContractFactory("MockUSDC");
    const usdc = (await Mock.deploy(10_000_000n)) as MockUSDC;
    await usdc.waitForDeployment();

    const depositAmount = 500_000n;
    await usdc.transfer(await alice.getAddress(), depositAmount);
    await usdc.connect(alice).approve(await vault.getAddress(), depositAmount);

    await expect(vault.connect(alice).deposit(await usdc.getAddress(), depositAmount))
      .to.emit(vault, "Deposited")
      .withArgs(await alice.getAddress(), await usdc.getAddress(), depositAmount);
  });

  it("only admin can update the Merkle root", async () => {
    const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
    await expect(vault.connect(alice).updateMerkleRoot(root)).to.be.revertedWithCustomError(
      vault,
      "OnlyAdmin"
    );
    await expect(vault.connect(admin).updateMerkleRoot(root))
      .to.emit(vault, "MerkleRootUpdated")
      .withArgs(root);
    expect(await vault.getMerkleRoot()).to.equal(root);
  });

  it("adminWithdraw succeeds with valid proof + signature, and nullifier prevents replay", async () => {
    const Mock = await ethers.getContractFactory("MockUSDC");
    const usdc = (await Mock.deploy(10_000_000n)) as MockUSDC;
    await usdc.waitForDeployment();

    const balance = 777_000n;
    await usdc.transfer(await alice.getAddress(), balance);

    const aliceBalBefore = await usdc.balanceOf(await alice.getAddress());
    await usdc.connect(alice).approve(await vault.getAddress(), balance);
    await vault.connect(alice).deposit(await usdc.getAddress(), balance);
    const aliceBalAfterDeposit = await usdc.balanceOf(await alice.getAddress());
    expect(aliceBalAfterDeposit).to.equal(aliceBalBefore - balance);

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
      vault
        .connect(admin)
        .adminWithdraw(await alice.getAddress(), await usdc.getAddress(), balance, proof, deadline, sig)
    )
      .to.emit(vault, "AdminWithdrawal")
      .withArgs(await alice.getAddress(), await usdc.getAddress(), balance, nullifier);

    const aliceBalAfterWithdraw = await usdc.balanceOf(await alice.getAddress());
    expect(aliceBalAfterWithdraw).to.equal(aliceBalBefore);

    await expect(
      vault
        .connect(admin)
        .adminWithdraw(await alice.getAddress(), await usdc.getAddress(), balance, proof, deadline, sig)
    ).to.be.revertedWithCustomError(vault, "NullifierAlreadyUsed");
  });

  it("withdraw succeeds for msg.sender == user with valid proof + signature (UserWithdrawal)", async () => {
    const Mock = await ethers.getContractFactory("MockUSDC");
    const usdc = (await Mock.deploy(10_000_000n)) as MockUSDC;
    await usdc.waitForDeployment();

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
      vault
        .connect(alice)
        .withdraw(await alice.getAddress(), await usdc.getAddress(), balance, proof, deadline, sig)
    )
      .to.emit(vault, "UserWithdrawal")
      .withArgs(await alice.getAddress(), await usdc.getAddress(), balance, nullifier);

    await expect(
      vault
        .connect(alice)
        .withdraw(await alice.getAddress(), await usdc.getAddress(), balance, proof, deadline, sig)
    ).to.be.revertedWithCustomError(vault, "NullifierAlreadyUsed");
  });

  it("withdraw reverts when caller is not user (NotSelf)", async () => {
    const Mock = await ethers.getContractFactory("MockUSDC");
    const usdc = (await Mock.deploy(10_000_000n)) as MockUSDC;
    await usdc.waitForDeployment();

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
      vault
        .connect(admin)
        .withdraw(await alice.getAddress(), await usdc.getAddress(), balance, proof, deadline, sig)
    ).to.be.revertedWithCustomError(vault, "NotSelf");
  });

  it("adminWithdraw reverts on bad proof, bad signature, expired deadline, or insufficient reserves", async () => {
    const Mock = await ethers.getContractFactory("MockUSDC");
    const usdc = (await Mock.deploy(10_000_000n)) as MockUSDC;
    await usdc.waitForDeployment();

    const depositAmount = 1000n;
    await usdc.transfer(await alice.getAddress(), depositAmount);
    await usdc.connect(alice).approve(await vault.getAddress(), depositAmount);
    await vault.connect(alice).deposit(await usdc.getAddress(), depositAmount);

    // Root commits a balance larger than reserves -> InsufficientReserves (proof must still be valid)
    const committedBalance = 2000n;
    const entries: [string, string, string][] = [
      [await alice.getAddress(), await usdc.getAddress(), committedBalance.toString()],
    ];
    const tree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    const root = tree.root as string;
    const proof = tree.getProof(0) as string[];
    await vault.connect(admin).updateMerkleRoot(root);

    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const nullifier = computeNullifier(root, await alice.getAddress(), await usdc.getAddress(), committedBalance);
    const sig = await signWithdrawAuth({
      signer: withdrawSigner,
      vault,
      user: await alice.getAddress(),
      token: await usdc.getAddress(),
      balance: committedBalance,
      nullifier,
      deadline: BigInt(deadline),
    });

    await expect(
      vault
        .connect(admin)
        .adminWithdraw(
          await alice.getAddress(),
          await usdc.getAddress(),
          committedBalance,
          proof,
          deadline,
          sig
        )
    ).to.be.revertedWithCustomError(vault, "InsufficientReserves");

    // Bad proof (wrong balance) -> InvalidMerkleProof
    await expect(
      vault
        .connect(admin)
        .adminWithdraw(
          await alice.getAddress(),
          await usdc.getAddress(),
          123n,
          proof,
          deadline,
          sig
        )
    ).to.be.revertedWithCustomError(vault, "InvalidMerkleProof");

    // Expired deadline -> WithdrawExpired
    await expect(
      vault
        .connect(admin)
        .adminWithdraw(
          await alice.getAddress(),
          await usdc.getAddress(),
          committedBalance,
          proof,
          (await ethers.provider.getBlock("latest"))!.timestamp - 1,
          sig
        )
    ).to.be.revertedWithCustomError(vault, "WithdrawExpired");

    // Bad signature -> InvalidSignature (sign with admin instead of withdrawSigner)
    const badSig = await signWithdrawAuth({
      signer: admin,
      vault,
      user: await alice.getAddress(),
      token: await usdc.getAddress(),
      balance: committedBalance,
      nullifier,
      deadline: BigInt(deadline),
    });
    await expect(
      vault
        .connect(admin)
        .adminWithdraw(
          await alice.getAddress(),
          await usdc.getAddress(),
          committedBalance,
          proof,
          deadline,
          badSig
        )
    ).to.be.revertedWithCustomError(vault, "InvalidSignature");
  });

  it("rescueToken only sweeps surplus (ERC-20), and reverts when no surplus", async () => {
    const Mock = await ethers.getContractFactory("MockUSDC");
    const usdc = (await Mock.deploy(10_000_000n)) as MockUSDC;
    await usdc.waitForDeployment();

    const depositAmount = 1000n;
    await usdc.transfer(await alice.getAddress(), depositAmount);
    await usdc.connect(alice).approve(await vault.getAddress(), depositAmount);
    await vault.connect(alice).deposit(await usdc.getAddress(), depositAmount);

    await expect(
      vault.connect(admin).rescueToken(await usdc.getAddress(), await admin.getAddress())
    ).to.be.revertedWithCustomError(vault, "NoSurplus");

    // Create surplus by transferring tokens directly (bypassing deposit/reserves accounting)
    const surplus = 500n;
    await usdc.transfer(await vault.getAddress(), surplus);

    const adminBalBefore = await usdc.balanceOf(await admin.getAddress());
    await vault.connect(admin).rescueToken(await usdc.getAddress(), await admin.getAddress());
    const adminBalAfter = await usdc.balanceOf(await admin.getAddress());
    expect(adminBalAfter).to.equal(adminBalBefore + surplus);
  });
});

describe("Veiledhood / edge cases", function () {
  let admin: HardhatEthersSigner;
  let withdrawSigner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;

  let vault: Veiledhood;

  beforeEach(async () => {
    [admin, withdrawSigner, alice] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("Veiledhood");
    vault = (await Vault.deploy(await admin.getAddress(), await withdrawSigner.getAddress())) as Veiledhood;
    await vault.waitForDeployment();
  });

  it("deposit: rejects zero amount, ETH msg.value mismatch, ERC20 msg.value mismatch, and ERC20 without approval", async () => {
    await expect(vault.connect(alice).deposit(ethers.ZeroAddress, 0, { value: 0 })).to.be.revertedWithCustomError(
      vault,
      "ZeroAmount"
    );

    await expect(vault.connect(alice).deposit(ethers.ZeroAddress, 10, { value: 9 })).to.be.revertedWithCustomError(
      vault,
      "MsgValueMismatch"
    );

    const Mock = await ethers.getContractFactory("MockUSDC");
    const usdc = (await Mock.deploy(1_000_000n)) as MockUSDC;
    await usdc.waitForDeployment();
    await usdc.transfer(await alice.getAddress(), 1000n);

    await expect(vault.connect(alice).deposit(await usdc.getAddress(), 100, { value: 1 })).to.be.revertedWithCustomError(
      vault,
      "MsgValueMismatch"
    );

    await expect(vault.connect(alice).deposit(await usdc.getAddress(), 100)).to.be.reverted;
  });

  it("updateMerkleRoot: rejects zero root; non-admin cannot update", async () => {
    await expect(vault.connect(admin).updateMerkleRoot(ethers.ZeroHash)).to.be.revertedWithCustomError(
      vault,
      "ZeroAddress"
    );

    const root = ethers.keccak256(ethers.toUtf8Bytes("r1"));
    await expect(vault.connect(alice).updateMerkleRoot(root)).to.be.revertedWithCustomError(vault, "OnlyAdmin");
  });

  it("admin controls: non-admin cannot withdraw, rescue, rotate admin, or rotate signer", async () => {
    const Mock = await ethers.getContractFactory("MockUSDC");
    const usdc = (await Mock.deploy(1_000_000n)) as MockUSDC;
    await usdc.waitForDeployment();

    await expect(
      vault.connect(alice).adminWithdraw(await alice.getAddress(), await usdc.getAddress(), 1n, [], 9999999999, "0x")
    ).to.be.revertedWithCustomError(vault, "OnlyAdmin");

    await expect(
      vault.connect(alice).rescueToken(await usdc.getAddress(), await admin.getAddress())
    ).to.be.revertedWithCustomError(vault, "OnlyAdmin");

    await expect(vault.connect(alice).transferAdmin(await alice.getAddress())).to.be.revertedWithCustomError(
      vault,
      "OnlyAdmin"
    );

    await expect(vault.connect(alice).setWithdrawSigner(await alice.getAddress())).to.be.revertedWithCustomError(
      vault,
      "OnlyAdmin"
    );
  });

  it("adminWithdraw: rejects zero user and zero balance", async () => {
    const Mock = await ethers.getContractFactory("MockUSDC");
    const usdc = (await Mock.deploy(1_000_000n)) as MockUSDC;
    await usdc.waitForDeployment();

    const root = ethers.keccak256(ethers.toUtf8Bytes("root"));
    await vault.connect(admin).updateMerkleRoot(root);

    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const nullifier = computeNullifier(root, await alice.getAddress(), await usdc.getAddress(), 1n);
    const sig = await signWithdrawAuth({
      signer: withdrawSigner,
      vault,
      user: await alice.getAddress(),
      token: await usdc.getAddress(),
      balance: 1n,
      nullifier,
      deadline: BigInt(deadline),
    });

    await expect(
      vault.connect(admin).adminWithdraw(ethers.ZeroAddress, await usdc.getAddress(), 1n, [], deadline, sig)
    ).to.be.revertedWithCustomError(vault, "ZeroAddress");

    await expect(
      vault.connect(admin).adminWithdraw(await alice.getAddress(), await usdc.getAddress(), 0n, [], deadline, sig)
    ).to.be.revertedWithCustomError(vault, "ZeroAmount");
  });

  it("verifyBalance: false before root is set; false for wrong balance; true for valid leaf", async () => {
    const Mock = await ethers.getContractFactory("MockUSDC");
    const usdc = (await Mock.deploy(1_000_000n)) as MockUSDC;
    await usdc.waitForDeployment();

    const balance = 123n;
    const entries: [string, string, string][] = [
      [await alice.getAddress(), await usdc.getAddress(), balance.toString()],
    ];
    const tree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    const root = tree.root as string;
    const proof = tree.getProof(0) as string[];

    expect(await vault.getMerkleRoot()).to.equal(ethers.ZeroHash);
    expect(await vault.verifyBalance(await alice.getAddress(), await usdc.getAddress(), balance, proof)).to.equal(
      false
    );

    await vault.connect(admin).updateMerkleRoot(root);
    expect(await vault.verifyBalance(await alice.getAddress(), await usdc.getAddress(), balance + 1n, proof)).to.equal(
      false
    );
    expect(await vault.verifyBalance(await alice.getAddress(), await usdc.getAddress(), balance, proof)).to.equal(true);
  });

  it("nullifier + signature bind to current merkle root (root rotation changes nullifier + invalidates old sig)", async () => {
    const Mock = await ethers.getContractFactory("MockUSDC");
    const usdc = (await Mock.deploy(10_000_000n)) as MockUSDC;
    await usdc.waitForDeployment();

    const balance = 400n;
    await usdc.transfer(await alice.getAddress(), balance);
    await usdc.connect(alice).approve(await vault.getAddress(), balance);
    await vault.connect(alice).deposit(await usdc.getAddress(), balance);

    const entries: [string, string, string][] = [
      [await alice.getAddress(), await usdc.getAddress(), balance.toString()],
    ];
    const tree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    const root1 = tree.root as string;
    const proof = tree.getProof(0) as string[];

    await vault.connect(admin).updateMerkleRoot(root1);

    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;
    const nullifier1 = computeNullifier(root1, await alice.getAddress(), await usdc.getAddress(), balance);
    expect(await vault.isNullifierSpent(nullifier1)).to.equal(false);

    const sig1 = await signWithdrawAuth({
      signer: withdrawSigner,
      vault,
      user: await alice.getAddress(),
      token: await usdc.getAddress(),
      balance,
      nullifier: nullifier1,
      deadline: BigInt(deadline),
    });

    const root2 = ethers.keccak256(ethers.toUtf8Bytes("different-root"));
    expect(root2).to.not.equal(root1);
    await vault.connect(admin).updateMerkleRoot(root2);

    // Same leaf/proof is not valid under a different root.
    await expect(
      vault
        .connect(admin)
        .adminWithdraw(await alice.getAddress(), await usdc.getAddress(), balance, proof, deadline, sig1)
    ).to.be.revertedWithCustomError(vault, "InvalidMerkleProof");

    // Old nullifier should still be unspent (withdraw never happened).
    expect(await vault.isNullifierSpent(nullifier1)).to.equal(false);

    const nullifier2 = computeNullifier(root2, await alice.getAddress(), await usdc.getAddress(), balance);
    expect(nullifier2).to.not.equal(nullifier1);

    // Signature that includes the wrong nullifier (old root's nullifier) must fail.
    const badSig = await signWithdrawAuth({
      signer: withdrawSigner,
      vault,
      user: await alice.getAddress(),
      token: await usdc.getAddress(),
      balance,
      nullifier: nullifier1,
      deadline: BigInt(deadline),
    });

    const newTree = StandardMerkleTree.of(entries, ["address", "address", "uint256"]);
    expect(newTree.root).to.equal(root1);
    await expect(
      vault
        .connect(admin)
        .adminWithdraw(await alice.getAddress(), await usdc.getAddress(), balance, proof, deadline, badSig)
    ).to.be.revertedWithCustomError(vault, "InvalidMerkleProof");

    const sig2 = await signWithdrawAuth({
      signer: withdrawSigner,
      vault,
      user: await alice.getAddress(),
      token: await usdc.getAddress(),
      balance,
      nullifier: nullifier2,
      deadline: BigInt(deadline),
    });

    // Still not valid: proof is for root1, but current root is root2.
    await expect(
      vault
        .connect(admin)
        .adminWithdraw(await alice.getAddress(), await usdc.getAddress(), balance, proof, deadline, sig2)
    ).to.be.revertedWithCustomError(vault, "InvalidMerkleProof");
  });

  it("rescueToken: rejects zero recipient", async () => {
    await expect(vault.connect(admin).rescueToken(ethers.ZeroAddress, ethers.ZeroAddress)).to.be.revertedWithCustomError(
      vault,
      "ZeroAddress"
    );
  });

  it("ETH adminWithdraw pays user and marks nullifier spent", async () => {
    const amount = 2n;
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
    expect(await vault.isNullifierSpent(nullifier)).to.equal(false);

    const sig = await signWithdrawAuth({
      signer: withdrawSigner,
      vault,
      user: await alice.getAddress(),
      token: ethers.ZeroAddress,
      balance: amount,
      nullifier,
      deadline: BigInt(deadline),
    });

    const balBefore = await ethers.provider.getBalance(await alice.getAddress());
    await (
      await vault
        .connect(admin)
        .adminWithdraw(await alice.getAddress(), ethers.ZeroAddress, amount, proof, deadline, sig)
    ).wait();

    const balAfter = await ethers.provider.getBalance(await alice.getAddress());
    // Admin pays execution gas; Alice should receive exactly `amount` of ETH from the vault transfer.
    expect(balAfter - balBefore).to.equal(amount);
    expect(await vault.isNullifierSpent(nullifier)).to.equal(true);
  });
});
