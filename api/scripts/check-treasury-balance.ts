/**
 * Report treasury balances: DB ledger (VeilSwap + Veiledhood) and on-chain wallet.
 * Usage: npx tsx scripts/check-treasury-balance.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { ethers, formatUnits } from "ethers";
import { SwapUserBalance } from "../src/models/SwapUserBalance.js";
import { UserBalance } from "../src/models/UserBalance.js";
import { VEILSWAP_ABI } from "../src/abi/veilSwap.js";
import { createJsonRpcProvider } from "../src/util/jsonRpcProvider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const TREASURY =
  process.env.VEILSWAP_TREASURY_ADDRESS?.trim().toLowerCase() ??
  process.env.TRANSFER_FEE_LEDGER_ADDRESS?.trim().toLowerCase();

const RPC = process.env.RPC_URL?.trim();
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 8453);
const VEILSWAP = process.env.VEILSWAP_ADDRESS?.trim();

const TOKENS: { symbol: string; address: string; decimals: number }[] = [
  { symbol: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
  { symbol: "DAI", address: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", decimals: 18 },
  { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
];

const erc20Abi = ["function balanceOf(address) view returns (uint256)"];

async function main(): Promise<void> {
  if (!TREASURY) {
    console.error("Set VEILSWAP_TREASURY_ADDRESS or TRANSFER_FEE_LEDGER_ADDRESS in .env");
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI not set");
    process.exit(1);
  }

  console.log("Treasury address:", TREASURY);
  console.log("Chain ID:", CHAIN_ID);
  console.log("");

  await mongoose.connect(process.env.MONGODB_URI);

  const swapRows = await SwapUserBalance.find({ address: TREASURY, chainId: CHAIN_ID }).lean();
  const userRows = await UserBalance.find({ address: TREASURY, chainId: CHAIN_ID }).lean();

  console.log("--- VeilSwap shielded ledger (SwapUserBalance) ---");
  if (swapRows.length === 0) {
    console.log("(none)");
  } else {
    for (const row of swapRows) {
      const tok = TOKENS.find((t) => t.address.toLowerCase() === row.tokenAddress);
      const dec = tok?.decimals ?? 18;
      const sym = tok?.symbol ?? row.tokenAddress.slice(0, 10);
      console.log(`  ${sym}: ${formatUnits(row.totalAmount, dec)} (${row.totalAmount} raw)`);
    }
  }

  console.log("");
  console.log("--- Veiledhood transfer-fee ledger (UserBalance) ---");
  if (userRows.length === 0) {
    console.log("(none)");
  } else {
    for (const row of userRows) {
      const isNative = row.currency === "native";
      const dec = isNative ? 18 : 6;
      const sym = isNative ? "ETH" : row.currency === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" ? "USDC" : row.currency;
      console.log(`  ${sym}: ${formatUnits(row.totalAmount, dec)} (${row.totalAmount} raw)`);
    }
  }

  if (RPC) {
    console.log("");
    console.log("--- On-chain wallet (EOA balances) ---");
    const provider = createJsonRpcProvider(RPC, CHAIN_ID);
    const ethBal = await provider.getBalance(TREASURY);
    console.log(`  ETH: ${formatUnits(ethBal, 18)} (${ethBal} wei)`);

    for (const tok of TOKENS) {
      const c = new ethers.Contract(tok.address, erc20Abi, provider);
      const bal: bigint = await c.balanceOf(TREASURY);
      console.log(`  ${tok.symbol}: ${formatUnits(bal, tok.decimals)} (${bal} raw)`);
    }

    if (VEILSWAP) {
      console.log("");
      console.log("--- VeilSwap contract reserves (not treasury-specific) ---");
      const vault = new ethers.Contract(VEILSWAP, VEILSWAP_ABI, provider);
      const zero = "0x0000000000000000000000000000000000000000";
      const ethRes: bigint = await vault.getReserves(zero);
      console.log(`  ETH reserves: ${formatUnits(ethRes, 18)}`);
      for (const tok of TOKENS) {
        const r: bigint = await vault.getReserves(tok.address);
        if (r > 0n) {
          console.log(`  ${tok.symbol} reserves: ${formatUnits(r, tok.decimals)}`);
        }
      }
    }
  } else {
    console.log("\n(RPC_URL unset — skipped on-chain checks)");
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
