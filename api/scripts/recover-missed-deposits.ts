/**
 * Recover Base deposits that the live-listener-only indexer missed.
 *
 * The current `startDepositIndexer` attaches a websocket listener but never
 * runs a startup catch-up scan, so any `Deposited` event emitted during an
 * API restart, RPC bounce, or indexer downtime is lost from the DB.
 *
 * This script takes a hardcoded list of known-missed tx hashes, re-fetches
 * each receipt from the configured Base RPC, decodes the `Deposited` event
 * from the vault, and applies it to the DB via the same dedupe-first path
 * that lives in `applyDepositedLog`. Already-recorded deposits are skipped
 * silently; never double-credits a balance.
 *
 * After applying, the on-chain Merkle root is re-committed so the recovered
 * users can immediately withdraw / transfer. The commit is a no-op if the
 * root has not changed.
 *
 * Safe to re-run: idempotent on both the DB and the on-chain root.
 *
 * Usage (after `npm run build`):
 *   node dist/scripts/recover-missed-deposits.js
 * Or from source:
 *   tsx api/scripts/recover-missed-deposits.ts
 */
import { ethers } from "ethers";
import mongoose from "mongoose";
import { loadEnv } from "../src/config/env.js";
import { VEILEDHOOD_ABI } from "../src/abi/veiledhood.js";
import { Deposit } from "../src/models/Deposit.js";
import { UserBalance } from "../src/models/UserBalance.js";
import { NATIVE_CURRENCY_KEY } from "../src/constants/currency.js";
import { buildAssetKey, DEFAULT_BASE_CHAIN_ID } from "../src/util/chainLedger.js";
import { normalizeLedgerCurrency } from "../src/util/ledgerCurrency.js";
import { commitMerkleRootFromDb } from "../src/services/veiledhoodAdmin.js";

/**
 * Tx hashes to recover. Append entries as more missed deposits are reported.
 * Each entry must be a successful `deposit()` call on the configured
 * `VAULT_ADDRESS` that emitted a single `Deposited(depositor, token, amount)`
 * log.
 */
const MISSED_TX_HASHES: string[] = [
  "0xfc80b9778295cb69f4ea0021cbe46bf120e7a0e4c4ab7ed7e5b8d1d539e10ae9",
  "0xe01db22c3cf4e308edef40f6b14127cf5e3b475c1a3987306a05668089d0d983",
];

function tokenToCurrencyKey(token: string): string {
  const t = token.toLowerCase();
  if (t === ethers.ZeroAddress.toLowerCase()) return NATIVE_CURRENCY_KEY;
  return ethers.getAddress(token);
}

type DepositedFields = {
  depositor: string;
  token: string;
  amount: bigint;
  blockNumber: number;
};

async function extractDeposited(
  provider: ethers.JsonRpcProvider,
  iface: ethers.Interface,
  vaultAddress: string,
  txHash: string,
): Promise<DepositedFields | null> {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt || receipt.status !== 1) return null;
  const vault = vaultAddress.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== vault) continue;
    let parsed: ethers.LogDescription | null;
    try {
      parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
    } catch {
      continue;
    }
    if (!parsed || parsed.name !== "Deposited") continue;
    return {
      depositor: (parsed.args.depositor as string).toLowerCase(),
      token: parsed.args.token as string,
      amount: parsed.args.amount as bigint,
      blockNumber: receipt.blockNumber,
    };
  }
  return null;
}

async function applyMissedDeposit(
  fields: DepositedFields,
  chainId: number,
  txHash: string,
): Promise<"created" | "duplicate"> {
  const address = fields.depositor;
  const currency = normalizeLedgerCurrency(tokenToCurrencyKey(fields.token));
  const assetKey = buildAssetKey(chainId, currency);

  // Dedupe FIRST: the Deposit collection has a unique index on `txHash`. If
  // the row already exists we bail before touching UserBalance, so re-runs
  // are no-ops instead of double-credits.
  try {
    await Deposit.create({
      address,
      chainId,
      assetKey,
      currency,
      amount: fields.amount.toString(),
      txHash,
    });
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: number }).code === 11000) {
      return "duplicate";
    }
    throw e;
  }

  const doc = await UserBalance.findOne({ address, chainId, assetKey });
  const prev = doc && /^\d+$/.test(doc.totalAmount) ? BigInt(doc.totalAmount) : 0n;
  const next = prev + fields.amount;
  await UserBalance.findOneAndUpdate(
    { address, chainId, assetKey },
    { $set: { address, chainId, assetKey, currency, totalAmount: next.toString() } },
    { upsert: true },
  );
  return "created";
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.RPC_URL?.trim() || !env.VAULT_ADDRESS?.trim() || !env.ADMIN_PRIVATE_KEY?.trim()) {
    throw new Error(
      "RPC_URL, VAULT_ADDRESS, and ADMIN_PRIVATE_KEY must be configured to recover deposits",
    );
  }
  const chainId = env.CHAIN_ID ?? env.BASE_CHAIN_ID ?? DEFAULT_BASE_CHAIN_ID;
  const vaultAddress = ethers.getAddress(env.VAULT_ADDRESS);
  const provider = new ethers.JsonRpcProvider(env.RPC_URL, chainId, {
    staticNetwork: true,
  });
  const iface = new ethers.Interface([...VEILEDHOOD_ABI]);

  console.log(`[recover-missed-deposits] connecting to Mongo…`);
  await mongoose.connect(env.MONGODB_URI);

  let created = 0;
  let duplicates = 0;
  let receiptMissing = 0;

  for (const txHash of MISSED_TX_HASHES) {
    console.log(`\n[recover-missed-deposits] processing ${txHash}`);
    const fields = await extractDeposited(provider, iface, vaultAddress, txHash);
    if (!fields) {
      console.warn(`  skipped: receipt missing, failed, or no Deposited log on vault`);
      receiptMissing += 1;
      continue;
    }
    console.log(
      `  depositor=${fields.depositor} token=${fields.token.toLowerCase()} amount=${fields.amount.toString()} block=${fields.blockNumber}`,
    );
    const result = await applyMissedDeposit(fields, chainId, txHash);
    if (result === "duplicate") {
      console.log(`  already in DB — no balance change`);
      duplicates += 1;
    } else {
      console.log(`  inserted and balance updated`);
      created += 1;
    }
  }

  console.log(`\n[recover-missed-deposits] summary:`, { created, duplicates, receiptMissing });

  if (created > 0) {
    console.log(`[recover-missed-deposits] committing on-chain Merkle root…`);
    const r = await commitMerkleRootFromDb({
      rpcUrl: env.RPC_URL,
      vaultAddress,
      adminPrivateKey: env.ADMIN_PRIVATE_KEY,
      staticChainId: chainId,
    });
    if (r.skipped) {
      console.log(`  root unchanged — skipped`);
    } else {
      console.log(`  root committed: tx ${r.txHash}`);
    }
  } else {
    console.log(`[recover-missed-deposits] nothing recovered, skipping root commit`);
  }

  await mongoose.disconnect();
  console.log(`[recover-missed-deposits] done.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
