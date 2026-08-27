import { ethers } from "ethers";
import { Transfer } from "../models/Transfer.js";
import { UserBalance } from "../models/UserBalance.js";
import type { Env } from "../config/env.js";
import {
  ledgerCurrencyMatchKeys,
  normalizeLedgerCurrency,
} from "../util/ledgerCurrency.js";
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
import {
  recordTransfer,
  type TransferFeeConfig,
} from "./recordTransfer.js";
import { buildAssetKey, DEFAULT_BASE_CHAIN_ID } from "../util/chainLedger.js";

export type TransferChainTxHashes = {
  merkleAfterTransferTxHash?: string;
  merkleAfterTransferSkipped?: boolean;
  adminWithdrawTxHash: string;
  merkleAfterPayoutTxHash?: string;
  merkleAfterPayoutSkipped?: boolean;
};

export class TransferPayoutNotConfiguredError extends Error {
  constructor() {
    super(
      "Transfer chain payout not configured (set RPC_URL, VAULT_ADDRESS, ADMIN_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY, SIGNER_PRIVATE_KEY)"
    );
    this.name = "TransferPayoutNotConfiguredError";
  }
}

function assertPayoutEnv(env: Env): {
  rpc: string;
  vault: string;
  adminPk: string;
  staticChainId?: number;
} {
  const rpc = env.RPC_URL?.trim();
  const vault = env.VAULT_ADDRESS?.trim();
  const adminPk = env.ADMIN_PRIVATE_KEY?.trim();
  if (!rpc || !vault || !adminPk || !env.SIGNER_PRIVATE_KEY?.trim()) {
    throw new TransferPayoutNotConfiguredError();
  }
  return {
    rpc,
    vault: ethers.getAddress(vault),
    adminPk,
    staticChainId: env.CHAIN_ID,
  };
}

async function rebuildTreeFromDb(chainId: number): Promise<ReturnType<typeof buildMerkleTree>> {
  const rows = await UserBalance.find({ chainId }).lean<
    { address: string; currency: string; totalAmount: string }[]
  >();
  const leaves = userBalancesToMerkleLeaves(rows);
  if (leaves.length === 0) {
    throw new Error("Cannot build Merkle tree: no positive UserBalance rows");
  }
  return buildMerkleTree(leaves);
}

/**
 * Off-chain transfer + Merkle root #2 + `adminWithdraw` to recipient + zero recipient balance + root #3.
 */
export async function executeTransferWithMerklePayout(params: {
  env: Env;
  fromAddress: string;
  toAddress: string;
  currency: string;
  amount: string;
  idempotencyKey: string;
  feeConfig: TransferFeeConfig;
}): Promise<
  | { kind: "duplicate"; transferId: string; chain?: TransferChainTxHashes | null }
  | { kind: "created"; transferId: string; chain: TransferChainTxHashes }
> {
  const { env, fromAddress, toAddress, currency, amount, idempotencyKey, feeConfig } =
    params;
  const chainId = env.CHAIN_ID ?? DEFAULT_BASE_CHAIN_ID;
  const assetKey = buildAssetKey(chainId, currency);

  const chainCfg = assertPayoutEnv(env);

  const rt = await recordTransfer({
    fromAddress,
    toAddress,
    chainId,
    currency,
    amount,
    idempotencyKey,
    feeConfig,
  });

  if (rt.status === "duplicate") {
    const doc = await Transfer.findOne({ idempotencyKey })
      .select(
        "merkleAfterTransferTxHash adminWithdrawTxHash merkleAfterPayoutTxHash"
      )
      .lean<{
        merkleAfterTransferTxHash?: string;
        adminWithdrawTxHash?: string;
        merkleAfterPayoutTxHash?: string;
      } | null>();
    if (doc?.adminWithdrawTxHash) {
      return {
        kind: "duplicate",
        transferId: rt.transferId,
        chain: {
          merkleAfterTransferTxHash: doc.merkleAfterTransferTxHash,
          adminWithdrawTxHash: doc.adminWithdrawTxHash,
          merkleAfterPayoutTxHash: doc.merkleAfterPayoutTxHash,
        },
      };
    }
    return { kind: "duplicate", transferId: rt.transferId };
  }

  const cur = normalizeLedgerCurrency(currency);
  const keys = ledgerCurrencyMatchKeys(currency);
  const token = ledgerCurrencyToMerkleToken(currency);

  // Recipient's CURRENT ledger balance after the credit from recordTransfer.
  // Veiledhood's adminWithdraw pays out the full leaf balance and the ledger leaf
  // is the user's total — not the per-transfer amount. Using `amountBn` here
  // caused "Leaf is not in tree" whenever the recipient already had a
  // nonzero balance from a prior deposit or transfer.
  const recvLedger = await UserBalance.findOne({
    address: toAddress,
    chainId,
    currency: { $in: keys },
  }).lean<{ currency?: string; totalAmount?: string } | null>();
  const recipientLeafBalance = BigInt(recvLedger?.totalAmount ?? "0");
  const recvKey = recvLedger?.currency ?? cur;

  // Zombie guard: an earlier transfer to the same recipient has already swept
  // the leaf via adminWithdraw before this one could settle. The recipient
  // has been paid; mark this transfer settled without re-running the chain.
  if (recipientLeafBalance === 0n) {
    const sentinel = "0x" + "00".repeat(32);
    await Transfer.updateOne(
      { idempotencyKey },
      {
        $set: {
          adminWithdrawTxHash: sentinel,
          payoutStatus: "payout_completed",
        },
      }
    );
    return {
      kind: "created",
      transferId: rt.transferId,
      chain: {
        merkleAfterTransferTxHash: undefined,
        merkleAfterTransferSkipped: true,
        adminWithdrawTxHash: sentinel,
        merkleAfterPayoutTxHash: undefined,
        merkleAfterPayoutSkipped: true,
      },
    };
  }

  const m1 = await commitMerkleRootFromDb({
    rpcUrl: chainCfg.rpc,
    vaultAddress: chainCfg.vault,
    adminPrivateKey: chainCfg.adminPk,
    staticChainId: chainCfg.staticChainId,
  });

  const tree = await rebuildTreeFromDb(chainId);
  const rootAfterTransfer = await readMerkleRoot(
    chainCfg.rpc,
    chainCfg.vault,
    chainCfg.staticChainId
  );
  if (rootAfterTransfer.toLowerCase() !== tree.root.toLowerCase()) {
    throw new Error(
      "Merkle root mismatch after updateMerkleRoot (transfer phase)"
    );
  }

  const proof = getProofForLeaf(tree, toAddress, token, recipientLeafBalance);
  const deadline =
    BigInt(Math.floor(Date.now() / 1000)) + BigInt(env.WITHDRAW_DEADLINE_MAX_SEC);

  const signed = await signVeiledhoodWithdrawAuth({
    env,
    merkleRoot: rootAfterTransfer,
    user: toAddress,
    token,
    balance: recipientLeafBalance,
    deadline,
  });

  const { txHash: adminTx } = await submitAdminWithdraw({
    rpcUrl: chainCfg.rpc,
    vaultAddress: chainCfg.vault,
    adminPrivateKey: chainCfg.adminPk,
    staticChainId: chainCfg.staticChainId,
    user: toAddress,
    token,
    balance: recipientLeafBalance,
    proof,
    deadline,
    signature: signed.signature,
  });

  await UserBalance.findOneAndUpdate(
    { address: toAddress, chainId, assetKey },
    {
      $set: {
        address: toAddress,
        chainId,
        assetKey,
        currency: recvKey,
        totalAmount: "0",
      },
    },
    { upsert: true }
  );

  const m2 = await commitMerkleRootFromDb({
    rpcUrl: chainCfg.rpc,
    vaultAddress: chainCfg.vault,
    adminPrivateKey: chainCfg.adminPk,
    staticChainId: chainCfg.staticChainId,
  });

  const chain: TransferChainTxHashes = {
    merkleAfterTransferTxHash: m1.txHash,
    merkleAfterTransferSkipped: m1.skipped,
    adminWithdrawTxHash: adminTx,
    merkleAfterPayoutTxHash: m2.txHash,
    merkleAfterPayoutSkipped: m2.skipped,
  };

  await Transfer.updateOne(
    { idempotencyKey },
    {
      $set: {
        ...(m1.txHash ? { merkleAfterTransferTxHash: m1.txHash } : {}),
        adminWithdrawTxHash: adminTx,
        ...(m2.txHash ? { merkleAfterPayoutTxHash: m2.txHash } : {}),
      },
      $unset: { payoutError: "" },
    }
  );

  return { kind: "created", transferId: rt.transferId, chain };
}

/**
 * If a prior request persisted the transfer in the DB but failed before `adminWithdraw`,
 * complete Merkle + payout using the same `idempotencyKey`.
 */
export async function resumeTransferMerklePayoutIfNeeded(
  env: Env,
  idempotencyKey: string
): Promise<TransferChainTxHashes | null> {
  const doc = await Transfer.findOne({ idempotencyKey })
    .select(
      "toAddress currency amount chainId adminWithdrawTxHash merkleAfterPayoutTxHash"
    )
    .lean<{
      toAddress: string;
      currency: string;
      amount: string;
      chainId?: number;
      adminWithdrawTxHash?: string;
      merkleAfterPayoutTxHash?: string;
    } | null>();
  if (!doc || doc.adminWithdrawTxHash) {
    return null;
  }

  const chainCfg = assertPayoutEnv(env);
  const chainId = doc.chainId ?? env.CHAIN_ID ?? DEFAULT_BASE_CHAIN_ID;
  const cur = normalizeLedgerCurrency(doc.currency);
  const assetKey = buildAssetKey(chainId, cur);
  const keys = ledgerCurrencyMatchKeys(doc.currency);
  const token = ledgerCurrencyToMerkleToken(doc.currency);

  // See note in executeTransferWithMerklePayout — the proof and adminWithdraw
  // must reference the recipient's full ledger leaf, not the per-transfer
  // amount that was originally requested.
  const recvLedger = await UserBalance.findOne({
    address: doc.toAddress,
    chainId,
    currency: { $in: keys },
  }).lean<{ currency?: string; totalAmount?: string } | null>();
  const recipientLeafBalance = BigInt(recvLedger?.totalAmount ?? "0");
  const recvKey = recvLedger?.currency ?? cur;

  // Zombie guard: a sibling transfer to the same recipient already swept the
  // leaf. Mark this transfer settled without re-running the chain.
  if (recipientLeafBalance === 0n) {
    const sentinel = "0x" + "00".repeat(32);
    await Transfer.updateOne(
      { idempotencyKey },
      {
        $set: {
          adminWithdrawTxHash: sentinel,
          payoutStatus: "payout_completed",
        },
        $unset: { payoutError: "" },
      }
    );
    return {
      merkleAfterTransferTxHash: undefined,
      merkleAfterTransferSkipped: true,
      adminWithdrawTxHash: sentinel,
      merkleAfterPayoutTxHash: undefined,
      merkleAfterPayoutSkipped: true,
    };
  }

  const m1 = await commitMerkleRootFromDb({
    rpcUrl: chainCfg.rpc,
    vaultAddress: chainCfg.vault,
    adminPrivateKey: chainCfg.adminPk,
    staticChainId: chainCfg.staticChainId,
  });

  const tree = await rebuildTreeFromDb(chainId);
  const rootAfterTransfer = await readMerkleRoot(
    chainCfg.rpc,
    chainCfg.vault,
    chainCfg.staticChainId
  );
  if (rootAfterTransfer.toLowerCase() !== tree.root.toLowerCase()) {
    throw new Error(
      "Merkle root mismatch after updateMerkleRoot (resume transfer phase)"
    );
  }

  const proof = getProofForLeaf(tree, doc.toAddress, token, recipientLeafBalance);
  const deadline =
    BigInt(Math.floor(Date.now() / 1000)) + BigInt(env.WITHDRAW_DEADLINE_MAX_SEC);

  const signed = await signVeiledhoodWithdrawAuth({
    env,
    merkleRoot: rootAfterTransfer,
    user: doc.toAddress,
    token,
    balance: recipientLeafBalance,
    deadline,
  });

  const { txHash: adminTx } = await submitAdminWithdraw({
    rpcUrl: chainCfg.rpc,
    vaultAddress: chainCfg.vault,
    adminPrivateKey: chainCfg.adminPk,
    staticChainId: chainCfg.staticChainId,
    user: doc.toAddress,
    token,
    balance: recipientLeafBalance,
    proof,
    deadline,
    signature: signed.signature,
  });

  await UserBalance.findOneAndUpdate(
    { address: doc.toAddress, chainId, assetKey },
    {
      $set: {
        address: doc.toAddress,
        chainId,
        assetKey,
        currency: recvKey,
        totalAmount: "0",
      },
    },
    { upsert: true }
  );

  const m2 = await commitMerkleRootFromDb({
    rpcUrl: chainCfg.rpc,
    vaultAddress: chainCfg.vault,
    adminPrivateKey: chainCfg.adminPk,
    staticChainId: chainCfg.staticChainId,
  });

  const chain: TransferChainTxHashes = {
    merkleAfterTransferTxHash: m1.txHash,
    merkleAfterTransferSkipped: m1.skipped,
    adminWithdrawTxHash: adminTx,
    merkleAfterPayoutTxHash: m2.txHash,
    merkleAfterPayoutSkipped: m2.skipped,
  };

  await Transfer.updateOne(
    { idempotencyKey },
    {
      $set: {
        ...(m1.txHash ? { merkleAfterTransferTxHash: m1.txHash } : {}),
        adminWithdrawTxHash: adminTx,
        ...(m2.txHash ? { merkleAfterPayoutTxHash: m2.txHash } : {}),
      },
      $unset: { payoutError: "" },
    }
  );

  return chain;
}
