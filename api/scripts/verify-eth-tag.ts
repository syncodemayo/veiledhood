/**
 * Diagnostic script: checks whether a user's ETH tag is registered and whether
 * the ownerCommit stored on-chain matches what the frontend would derive.
 *
 * Usage:
 *   tsx scripts/verify-eth-tag.ts <wallet-address>
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

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

const VEILEDHOOD_ETH_ABI = [
  "function encryptedBalanceOfTag(bytes32 tag) view returns (uint256)",
  "function treasuryTag() view returns (bytes32)",
  "function transferFeeBps() view returns (uint16)",
] as const;

async function main() {
  const walletAddr = process.argv[2];
  if (!walletAddr || !ethers.isAddress(walletAddr)) {
    console.error("Usage: tsx scripts/verify-eth-tag.ts <wallet-address>");
    process.exit(1);
  }

  const rpc = process.env.ETH_RPC_URL?.trim();
  const vaultRaw = process.env.ETH_VAULT_ADDRESS?.trim();
  const chainId = process.env.ETH_CHAIN_ID ? Number(process.env.ETH_CHAIN_ID) : 11155111;
  if (!rpc || !vaultRaw) {
    console.error("ETH_RPC_URL and ETH_VAULT_ADDRESS must be set");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpc, chainId);
  const vault = ethers.getAddress(vaultRaw);
  const contract = new ethers.Contract(vault, VEILEDHOOD_ETH_ABI, provider);

  const addr = ethers.getAddress(walletAddr);
  const tag = deriveEthUserTag(addr);
  const secret = deterministicEthOwnerSecret(addr);
  const expectedCommit = ethOwnerCommit(addr, secret);

  console.log("Wallet   :", addr);
  console.log("Tag      :", tag);
  console.log("Secret   :", secret);
  console.log("Expected ownerCommit:", expectedCommit);

  try {
    await contract.encryptedBalanceOfTag(tag);
    console.log("Tag status: REGISTERED ✓");
  } catch (e) {
    console.log("Tag status: NOT REGISTERED ✗ —", e instanceof Error ? e.message : e);
    process.exit(0);
  }

  const feeBps: bigint = await contract.transferFeeBps();
  const treasuryTag: string = await contract.treasuryTag();
  console.log("Fee BPS  :", feeBps.toString());
  console.log("Treasury tag:", treasuryTag);

  try {
    await contract.encryptedBalanceOfTag(treasuryTag);
    console.log("Treasury status: REGISTERED ✓");
  } catch {
    console.log("Treasury status: NOT REGISTERED ✗ — run register-treasury-tag.ts");
  }

  console.log("\nNote: ownerCommit is stored in the contract and not publicly readable.");
  console.log("If transferEncryptedToTag reverts with NotAuthorized, re-register your tag.");
  console.log("To re-register: clear localStorage 'veiledhood_eth_tag', reconnect, and deposit again.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
