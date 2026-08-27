/**
 * One-time script: registers the VeiledhoodETHVault treasury tag on Sepolia.
 * Run once before any fee-bearing transfer can succeed.
 *
 * Usage:
 *   tsx scripts/register-treasury-tag.ts
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ethers } from "ethers";
import {
  createInstance,
  SepoliaConfig,
} from "@zama-fhe/relayer-sdk/node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const VEILEDHOOD_ETH_ABI = [
  "function registerTag(bytes32 tag, bytes32 encOwner, bytes calldata inputProof, bytes32 ownerCommit_) external",
  "function encryptedBalanceOfTag(bytes32 tag) view returns (uint256)",
  "function treasuryTag() view returns (bytes32)",
  "function transferFeeBps() view returns (uint16)",
  "function transferFeeFixed() view returns (uint128)",
] as const;

function require_env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function main() {
  const rpc       = require_env("ETH_RPC_URL");
  const vaultAddr = require_env("ETH_VAULT_ADDRESS");
  const adminPk   = process.env.ADMIN_PRIVATE_KEY?.trim() || require_env("DEPLOYER_PRIVATE_KEY");
  const chainId   = process.env.ETH_CHAIN_ID ? Number(process.env.ETH_CHAIN_ID) : 11155111;

  const provider = new ethers.JsonRpcProvider(rpc, chainId);
  const wallet   = new ethers.Wallet(adminPk, provider);
  const vault    = ethers.getAddress(vaultAddr);
  const contract = new ethers.Contract(vault, VEILEDHOOD_ETH_ABI, wallet);

  console.log("Admin wallet :", wallet.address);
  console.log("Vault        :", vault);
  console.log("Chain ID     :", chainId);

  const feeBps: bigint  = await contract.transferFeeBps();
  const feeFixed: bigint = await contract.transferFeeFixed();
  const treasuryTag: string = await contract.treasuryTag();

  console.log("transferFeeBps  :", feeBps.toString());
  console.log("transferFeeFixed:", feeFixed.toString());
  console.log("treasuryTag     :", treasuryTag);

  if (feeBps === 0n && feeFixed === 0n) {
    console.log("No fees configured — treasury tag registration not required.");
    process.exit(0);
  }

  // Check if already registered.
  try {
    await contract.encryptedBalanceOfTag(treasuryTag);
    console.log("Treasury tag is already registered. Nothing to do.");
    process.exit(0);
  } catch {
    console.log("Treasury tag not yet registered — registering now...");
  }

  // ownerCommit = keccak256(abi.encodePacked(wallet.address, secret))
  // secret defaults to keccak256("script-treasury-secret"), matching the hardhat test script.
  const secret =
    process.env.ETH_TREASURY_SECRET?.trim() ??
    ethers.keccak256(ethers.toUtf8Bytes("script-treasury-secret"));

  const ownerCommit = ethers.keccak256(
    ethers.solidityPacked(["address", "bytes32"], [wallet.address, secret])
  );

  console.log("Generating FHE proof (encryptorAddress =", wallet.address, ")...");
  const instance = await createInstance({
    ...SepoliaConfig,
    chainId,
    network: rpc,
  });
  const input = instance.createEncryptedInput(vault, wallet.address);
  input.addAddress(wallet.address);
  const enc = await input.encrypt();
  const encOwner   = ethers.hexlify(enc.handles[0]) as `0x${string}`;
  const inputProof = ethers.hexlify(enc.inputProof) as `0x${string}`;

  console.log("Sending registerTag tx...");
  const tx = await contract.registerTag(treasuryTag, encOwner, inputProof, ownerCommit, {
    gasLimit: 1_000_000n,
  });
  console.log("Tx hash:", tx.hash);

  const receipt = await tx.wait();
  if (receipt?.status !== 1) {
    console.error("Transaction reverted!");
    process.exit(1);
  }

  console.log("Treasury tag registered successfully.");

  // Verify.
  try {
    await contract.encryptedBalanceOfTag(treasuryTag);
    console.log("Verified: encryptedBalanceOfTag now succeeds for treasury tag.");
  } catch (e) {
    console.error("Verification failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
