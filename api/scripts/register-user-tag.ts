/**
 * One-time recovery script: registers a user's ETH tag on-chain if not already registered.
 * Use when a tag was cached in localStorage but the on-chain registration tx had silently reverted.
 *
 * Usage:
 *   tsx scripts/register-user-tag.ts <wallet-address>
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
] as const;

function deriveEthUserTag(owner: string): string {
  return ethers.keccak256(
    ethers.toUtf8Bytes(`veiledhood-user-tag:${ethers.getAddress(owner).toLowerCase()}`)
  );
}

function deterministicEthOwnerSecret(owner: string): string {
  return ethers.keccak256(
    ethers.toUtf8Bytes(`veiledhood-eth-owner-secret-v1:${ethers.getAddress(owner).toLowerCase()}`)
  );
}

function ethOwnerCommit(owner: string, secret: string): string {
  return ethers.keccak256(
    ethers.solidityPacked(["address", "bytes32"], [ethers.getAddress(owner), secret])
  );
}

async function main() {
  const walletAddr = process.argv[2];
  if (!walletAddr || !ethers.isAddress(walletAddr)) {
    console.error("Usage: tsx scripts/register-user-tag.ts <wallet-address>");
    process.exit(1);
  }

  const rpc       = process.env.ETH_RPC_URL?.trim();
  const vaultRaw  = process.env.ETH_VAULT_ADDRESS?.trim();
  const adminPk   = process.env.ADMIN_PRIVATE_KEY?.trim() || process.env.DEPLOYER_PRIVATE_KEY?.trim();
  const chainId   = process.env.ETH_CHAIN_ID ? Number(process.env.ETH_CHAIN_ID) : 11155111;

  if (!rpc || !vaultRaw || !adminPk) {
    console.error("ETH_RPC_URL, ETH_VAULT_ADDRESS, and admin key must be set in .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpc, chainId);
  const wallet   = new ethers.Wallet(adminPk, provider);
  const vault    = ethers.getAddress(vaultRaw);
  const contract = new ethers.Contract(vault, VEILEDHOOD_ETH_ABI, wallet);

  const ownerAddr = ethers.getAddress(walletAddr);
  const tag       = deriveEthUserTag(ownerAddr);
  const secret    = deterministicEthOwnerSecret(ownerAddr);
  const commit    = ethOwnerCommit(ownerAddr, secret);

  console.log("Admin wallet :", wallet.address);
  console.log("User wallet  :", ownerAddr);
  console.log("Tag          :", tag);
  console.log("ownerCommit  :", commit);

  try {
    await contract.encryptedBalanceOfTag(tag);
    console.log("Tag is already registered on-chain. Nothing to do.");
    process.exit(0);
  } catch {
    console.log("Tag not registered — registering now...");
  }

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
  const tx = await contract.registerTag(tag, encOwner, inputProof, commit, {
    gasLimit: 1_000_000n,
  });
  console.log("Tx hash:", tx.hash);

  const receipt = await tx.wait();
  if (receipt?.status !== 1) {
    console.error("Transaction reverted!");
    process.exit(1);
  }

  console.log("User tag registered successfully.");

  // Verify.
  try {
    await contract.encryptedBalanceOfTag(tag);
    console.log("Verified: encryptedBalanceOfTag succeeds for user tag.");
  } catch (e) {
    console.error("Verification failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
