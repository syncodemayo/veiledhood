import { ethers } from "ethers";
import { UserBalance } from "../models/UserBalance.js";
import type { Env } from "../config/env.js";
import { applyLedgerSplit } from "./bridgeLedgerSplit.js";
import { buildMerkleTree, getProofForLeaf } from "./merkleTree.js";
import {
  ledgerCurrencyToMerkleToken,
  userBalancesToMerkleLeaves,
} from "./ledgerLeaves.js";
import {
  commitMerkleRootFromDb,
  readMerkleRoot,
  submitAdminWithdraw,
} from "./veiledhoodAdmin.js";
import { signVeiledhoodWithdrawAuth } from "./signWithdrawAuth.js";
import { normalizeLedgerCurrency } from "../util/ledgerCurrency.js";
import { buildAssetKey } from "../util/chainLedger.js";

/** Indirection so the DB-side logic is unit-testable without RPC (see test). */
export interface SourceChainOps {
  commitRoot(): Promise<{ root: string; txHash?: string; skipped: boolean }>;
  readRoot(): Promise<string>;
  proofForEscrow(escrow: string, token: string, balance: bigint): Promise<string[]>;
  signAuth(args: {
    root: string;
    user: string;
    token: string;
    balance: bigint;
  }): Promise<{ signature: string; deadline: bigint }>;
  adminWithdraw(args: {
    user: string;
    token: string;
    balance: bigint;
    proof: string[];
    deadline: bigint;
    signature: string;
  }): Promise<{ txHash: string }>;
}

/** Production SourceChainOps bound to a per-chain effective env. */
export function makeSourceChainOps(env: Env): SourceChainOps {
  const rpc = env.RPC_URL!.trim();
  const vault = ethers.getAddress(env.VAULT_ADDRESS!.trim());
  const adminPk = env.ADMIN_PRIVATE_KEY!.trim();
  const staticChainId = env.CHAIN_ID;
  return {
    commitRoot: () =>
      commitMerkleRootFromDb({ rpcUrl: rpc, vaultAddress: vault, adminPrivateKey: adminPk, staticChainId }),
    readRoot: () => readMerkleRoot(rpc, vault, staticChainId),
    async proofForEscrow(escrow, token, balance) {
      const rows = await UserBalance.find({ chainId: staticChainId }).lean<
        { address: string; currency: string; totalAmount: string }[]
      >();
      const tree = buildMerkleTree(userBalancesToMerkleLeaves(rows));
      return getProofForLeaf(tree, escrow, token, balance);
    },
    async signAuth({ root, user, token, balance }) {
      const deadline = BigInt(Math.floor(Date.now() / 1000)) + BigInt(env.WITHDRAW_DEADLINE_MAX_SEC);
      const signed = await signVeiledhoodWithdrawAuth({ env, merkleRoot: root, user, token, balance, deadline });
      return { signature: signed.signature, deadline };
    },
    adminWithdraw: (a) =>
      submitAdminWithdraw({
        rpcUrl: rpc, vaultAddress: vault, adminPrivateKey: adminPk, staticChainId,
        user: a.user, token: a.token, balance: a.balance, proof: a.proof,
        deadline: a.deadline, signature: a.signature,
      }),
  };
}

export interface SourceWithdrawResult {
  rootAfterSplitTxHash?: string;
  adminWithdrawTxHash: string;
  rootAfterPayoutTxHash?: string;
}

/**
 * Split the user's leaf into a fresh escrow leaf and pay the escrow leaf out
 * on-chain. After this the escrow ADDRESS holds `amount` of `token`, and the
 * escrow LEAF is zeroed (so it can't be re-withdrawn).
 */
export async function withdrawEscrowLeaf(params: {
  chainId: number;
  currency: string;
  userAddress: string;
  escrowAddress: string;
  amount: bigint;
  chain: SourceChainOps;
}): Promise<SourceWithdrawResult> {
  const { chainId, currency, userAddress, escrowAddress, amount, chain } = params;
  const token = ledgerCurrencyToMerkleToken(currency);
  const cur = normalizeLedgerCurrency(currency);
  const assetKey = buildAssetKey(chainId, cur);

  // 1) Off-chain split: user -= amount, escrow += amount.
  await applyLedgerSplit({ userAddress, escrowAddress, chainId, currency, amount });

  // 2) Commit root #1 (now includes the escrow leaf).
  const m1 = await chain.commitRoot();
  const root = await chain.readRoot();

  // 3) Prove + sign + adminWithdraw the escrow leaf to the escrow address.
  const proof = await chain.proofForEscrow(escrowAddress, token, amount);
  const { signature, deadline } = await chain.signAuth({
    root, user: escrowAddress, token, balance: amount,
  });
  const { txHash } = await chain.adminWithdraw({
    user: escrowAddress, token, balance: amount, proof, deadline, signature,
  });

  // 4) Zero the escrow leaf, commit root #2.
  await UserBalance.findOneAndUpdate(
    { address: escrowAddress, chainId, assetKey },
    { $set: { address: escrowAddress, chainId, assetKey, currency: cur, totalAmount: "0" } },
    { upsert: true }
  );
  const m2 = await chain.commitRoot();

  return {
    rootAfterSplitTxHash: m1.txHash,
    adminWithdrawTxHash: txHash,
    rootAfterPayoutTxHash: m2.txHash,
  };
}
