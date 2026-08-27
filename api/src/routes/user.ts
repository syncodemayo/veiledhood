import { Router } from "express";
import { ethers } from "ethers";
import { z } from "zod";
import type { Env } from "../config/env.js";
import {
  requireAuth,
  type AuthedRequest,
} from "../middleware/requireAuth.js";
import { Deposit } from "../models/Deposit.js";
import { Transfer } from "../models/Transfer.js";
import { UserBalance } from "../models/UserBalance.js";
import { Withdraw } from "../models/Withdraw.js";
import { recordDeposit } from "../services/recordDeposit.js";
import { signVeiledhoodWithdrawAuth } from "../services/signWithdrawAuth.js";
import {
  commitMerkleRootFromDb,
  readMerkleRoot,
} from "../services/veiledhoodAdmin.js";
import { buildMerkleTree, getProofForLeaf } from "../services/merkleTree.js";
import {
  ledgerCurrencyToMerkleToken,
  userBalancesToMerkleLeaves,
} from "../services/ledgerLeaves.js";
import {
  aggregateUserBalancesForMe,
  ledgerCurrencyMatchKeys,
} from "../util/ledgerCurrency.js";
import {
  DEFAULT_BASE_CHAIN_ID,
  DEFAULT_ETH_CHAIN_ID,
} from "../util/chainLedger.js";

const UINT256_MAX = 2n ** 256n - 1n;

const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
  chainId: z.coerce.number().int().positive().optional(),
});

const withdrawSignatureBodySchema = z.object({
  amount: z
    .string()
    .regex(/^\d+$/)
    .refine((s) => {
      const b = BigInt(s);
      return b > 0n && b <= UINT256_MAX;
    }, "amount must be a positive uint256"),
  deadline: z.coerce.number().int().positive(),
  currency: z.string().trim().min(1),
});


const ethDepositBodySchema = z.object({
  amount: z
    .string()
    .regex(/^\d+$/)
    .refine((s) => BigInt(s) > 0n, "amount must be positive"),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "must be 32-byte hex hash").optional(),
  currency: z.string().trim().min(1).default("native"),
});

export function createUserRouter(env: Env): Router {
  const router = Router();

  /**
   * EIP-712 + Merkle proof for `Veiledhood.withdraw` (self). Amount must match the current ledger leaf.
   */
  router.post(
    "/user/withdraw-signature",
    requireAuth(env),
    async (req: AuthedRequest, res) => {
      const parsed = withdrawSignatureBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid body",
          details: parsed.error.flatten(),
        });
        return;
      }

      const address = req.walletAddress!;
      const { amount, deadline } = parsed.data;
      const curRaw = parsed.data.currency.trim();
      const currencyKeys = ledgerCurrencyMatchKeys(curRaw);

      const nowSec = Math.floor(Date.now() / 1000);
      if (deadline <= nowSec) {
        res.status(400).json({ error: "deadline must be in the future" });
        return;
      }
      if (deadline > nowSec + env.WITHDRAW_DEADLINE_MAX_SEC) {
        res.status(400).json({
          error: `deadline must be within ${env.WITHDRAW_DEADLINE_MAX_SEC} seconds from now`,
        });
        return;
      }

      const bal = await UserBalance.findOne({
        address,
        chainId: env.CHAIN_ID ?? DEFAULT_BASE_CHAIN_ID,
        currency: { $in: currencyKeys },
      }).lean<{ totalAmount?: string; currency?: string } | null>();
      const available = bal ? BigInt(bal.totalAmount ?? "0") : 0n;
      const need = BigInt(amount);
      if (available !== need) {
        res.status(400).json({
          error:
            "Withdraw amount must equal your full ledger balance for this token (partial Merkle leaves are not supported)",
          available: available.toString(),
        });
        return;
      }

      const rpc = env.RPC_URL?.trim();
      const vault = env.VAULT_ADDRESS?.trim();
      const adminPk = env.ADMIN_PRIVATE_KEY?.trim();
      if (!rpc || !vault || !adminPk || !env.SIGNER_PRIVATE_KEY?.trim()) {
        res.status(503).json({
          error:
            "Withdraw signing is not configured (RPC_URL, VAULT_ADDRESS, ADMIN_PRIVATE_KEY, SIGNER_PRIVATE_KEY)",
        });
        return;
      }

      const token = ledgerCurrencyToMerkleToken(curRaw);
      try {
        await commitMerkleRootFromDb({
          rpcUrl: rpc,
          vaultAddress: ethers.getAddress(vault),
          adminPrivateKey: adminPk,
          staticChainId: env.CHAIN_ID,
        });
      } catch (e) {
        console.error("[withdraw-signature] commitMerkleRootFromDb", e);
        res.status(502).json({
          error: "Failed to commit Merkle root before withdraw",
          message: e instanceof Error ? e.message : String(e),
        });
        return;
      }

      const rows = await UserBalance.find({
        chainId: env.CHAIN_ID ?? DEFAULT_BASE_CHAIN_ID,
      }).lean<
        { address: string; currency: string; totalAmount: string }[]
      >();
      const leaves = userBalancesToMerkleLeaves(rows);
      if (leaves.length === 0) {
        res.status(400).json({ error: "No positive balances in Merkle tree" });
        return;
      }
      const tree = buildMerkleTree(leaves);
      const merkleRoot = await readMerkleRoot(
        rpc,
        ethers.getAddress(vault),
        env.CHAIN_ID
      );
      if (merkleRoot.toLowerCase() !== tree.root.toLowerCase()) {
        res.status(500).json({ error: "Merkle root out of sync; retry shortly" });
        return;
      }

      const proof = getProofForLeaf(tree, address, token, need);
      const signed = await signVeiledhoodWithdrawAuth({
        env,
        merkleRoot,
        user: address,
        token,
        balance: need,
        deadline: BigInt(deadline),
      });

      res.json({
        merkleRoot,
        proof,
        ...signed,
      });
    }
  );

  /**
   * Merkle-based withdraw signature for Veiledhood on Ethereum — same flow as
   * `/user/withdraw-signature` but uses ETH chain config.
   */
  router.post(
    "/eth/user/withdraw-signature",
    requireAuth(env),
    async (req: AuthedRequest, res) => {
      const parsed = withdrawSignatureBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
        return;
      }

      const address = req.walletAddress!;
      const { amount, deadline } = parsed.data;
      const curRaw = parsed.data.currency.trim();
      const currencyKeys = ledgerCurrencyMatchKeys(curRaw);

      const nowSec = Math.floor(Date.now() / 1000);
      if (deadline <= nowSec) {
        res.status(400).json({ error: "deadline must be in the future" });
        return;
      }
      if (deadline > nowSec + env.WITHDRAW_DEADLINE_MAX_SEC) {
        res.status(400).json({
          error: `deadline must be within ${env.WITHDRAW_DEADLINE_MAX_SEC} seconds from now`,
        });
        return;
      }

      const chainId = env.ETH_CHAIN_ID ?? DEFAULT_ETH_CHAIN_ID;
      const bal = await UserBalance.findOne({
        address,
        chainId,
        currency: { $in: currencyKeys },
      }).lean<{ totalAmount?: string } | null>();
      const available = bal ? BigInt(bal.totalAmount ?? "0") : 0n;
      const need = BigInt(amount);
      if (available !== need) {
        res.status(400).json({
          error: "Withdraw amount must equal your full ledger balance for this token",
          available: available.toString(),
        });
        return;
      }

      const rpc = env.ETH_RPC_URL?.trim();
      const vault = env.ETH_VAULT_ADDRESS?.trim();
      const adminPk = env.ADMIN_PRIVATE_KEY?.trim();
      if (!rpc || !vault || !adminPk || !env.SIGNER_PRIVATE_KEY?.trim()) {
        res.status(503).json({
          error: "ETH withdraw signing not configured (ETH_RPC_URL, ETH_VAULT_ADDRESS, ADMIN_PRIVATE_KEY, SIGNER_PRIVATE_KEY)",
        });
        return;
      }

      const ethEnv = { ...env, RPC_URL: rpc, VAULT_ADDRESS: vault, CHAIN_ID: chainId };
      const token = ledgerCurrencyToMerkleToken(curRaw);
      try {
        await commitMerkleRootFromDb({
          rpcUrl: rpc,
          vaultAddress: ethers.getAddress(vault),
          adminPrivateKey: adminPk,
          staticChainId: chainId,
        });
      } catch (e) {
        console.error("[eth/withdraw-signature] commitMerkleRootFromDb", e);
        res.status(502).json({
          error: "Failed to commit ETH Merkle root before withdraw",
          message: e instanceof Error ? e.message : String(e),
        });
        return;
      }

      const rows = await UserBalance.find({ chainId }).lean<
        { address: string; currency: string; totalAmount: string }[]
      >();
      const leaves = userBalancesToMerkleLeaves(rows);
      if (leaves.length === 0) {
        res.status(400).json({ error: "No positive balances in ETH Merkle tree" });
        return;
      }
      const tree = buildMerkleTree(leaves);
      const merkleRoot = await readMerkleRoot(rpc, ethers.getAddress(vault), chainId);
      if (merkleRoot.toLowerCase() !== tree.root.toLowerCase()) {
        res.status(500).json({ error: "ETH Merkle root out of sync; retry shortly" });
        return;
      }

      const proof = getProofForLeaf(tree, address, token, need);
      const signed = await signVeiledhoodWithdrawAuth({
        env: ethEnv,
        merkleRoot,
        user: address,
        token,
        balance: need,
        deadline: BigInt(deadline),
      });

      res.json({ merkleRoot, proof, ...signed });
    }
  );

  router.post(
    "/eth/deposits",
    requireAuth(env),
    async (req: AuthedRequest, res) => {
      const parsed = ethDepositBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid body",
          details: parsed.error.flatten(),
        });
        return;
      }

      const { txHash, amount, currency } = parsed.data;

      try {
        const result = await recordDeposit({
          address: req.walletAddress!,
          chainId: env.ETH_CHAIN_ID ?? DEFAULT_ETH_CHAIN_ID,
          currency,
          amount,
          txHash: txHash ?? ethers.hexlify(ethers.randomBytes(32)),
        });

        res.status(200).json(result);
      } catch (e) {
        console.error("[eth-deposits]", e);
        res.status(500).json({
          error: "Failed to record ETH deposit",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  );

  router.get(
    "/user/activity",
    requireAuth(env),
    async (req: AuthedRequest, res) => {
      const parsed = activityQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid query",
          details: parsed.error.flatten(),
        });
        return;
      }

      const limit = parsed.data.limit ?? 20;
      const offset = parsed.data.offset ?? 0;
      const chainId = parsed.data.chainId;
      const cap = Math.min(
        2000,
        Math.max(offset + limit + 120, Math.max(limit * 25, 120)),
      );
      const address = req.walletAddress!;

      const [deposits, withdraws, transfers] = await Promise.all([
        Deposit.find({ address, ...(chainId ? { chainId } : {}) })
          .sort({ createdAt: -1 })
          .limit(cap)
          .select("amount currency txHash chainId createdAt")
          .lean<
            {
              amount: string;
              currency: string;
              txHash: string;
              chainId: number;
              createdAt: Date;
            }[]
          >(),
        Withdraw.find({ address, ...(chainId ? { chainId } : {}) })
          .sort({ createdAt: -1 })
          .limit(cap)
          .select("amount currency txHash chainId createdAt")
          .lean<
            {
              amount: string;
              currency: string;
              txHash: string;
              chainId: number;
              createdAt: Date;
            }[]
          >(),
        Transfer.find({
          $and: [
            { $or: [{ fromAddress: address }, { toAddress: address }] },
            ...(chainId ? [{ chainId }] : []),
          ],
        })
          .sort({ createdAt: -1 })
          .limit(cap)
          .select(
            "fromAddress toAddress amount currency chainId payoutStatus idempotencyKey merkleAfterTransferTxHash adminWithdrawTxHash merkleAfterPayoutTxHash createdAt"
          )
          .lean<
            {
              fromAddress: string;
              toAddress: string;
              amount: string;
              currency: string;
              chainId: number;
              payoutStatus?: "pending_payout" | "payout_completed" | "payout_failed";
              idempotencyKey: string;
              merkleAfterTransferTxHash?: string;
              adminWithdrawTxHash?: string;
              merkleAfterPayoutTxHash?: string;
              createdAt: Date;
            }[]
          >(),
      ]);

      type ActivityItem =
        | {
            kind: "deposit";
            amount: string;
            currency: string;
            chainId: number;
            createdAt: string;
            txHash: string;
          }
        | {
            kind: "withdraw";
            amount: string;
            currency: string;
            chainId: number;
            createdAt: string;
            txHash: string;
          }
        | {
            kind: "transfer";
            direction: "in" | "out";
            amount: string;
            currency: string;
            chainId: number;
            createdAt: string;
            idempotencyKey: string;
            payoutStatus?: "pending_payout" | "payout_completed" | "payout_failed";
            adminWithdrawTxHash?: string | null;
            merkleAfterTransferTxHash?: string | null;
            merkleAfterPayoutTxHash?: string | null;
            counterparty: string;
          };

      const items: ActivityItem[] = [];

      for (const d of deposits) {
        items.push({
          kind: "deposit",
          amount: d.amount,
          currency: d.currency,
          chainId: d.chainId,
          createdAt: d.createdAt.toISOString(),
          txHash: d.txHash,
        });
      }
      for (const w of withdraws) {
        items.push({
          kind: "withdraw",
          amount: w.amount,
          currency: w.currency,
          chainId: w.chainId,
          createdAt: w.createdAt.toISOString(),
          txHash: w.txHash,
        });
      }
      for (const t of transfers) {
        const out = t.fromAddress === address;
        items.push({
          kind: "transfer",
          direction: out ? "out" : "in",
          amount: t.amount,
          currency: t.currency,
          chainId: t.chainId,
          createdAt: t.createdAt.toISOString(),
          idempotencyKey: t.idempotencyKey,
          payoutStatus: t.payoutStatus,
          adminWithdrawTxHash: t.adminWithdrawTxHash ?? null,
          merkleAfterTransferTxHash: t.merkleAfterTransferTxHash ?? null,
          merkleAfterPayoutTxHash: t.merkleAfterPayoutTxHash ?? null,
          counterparty: out ? t.toAddress : t.fromAddress,
        });
      }

      items.sort((a, b) => {
        const tb = new Date(b.createdAt).getTime();
        const ta = new Date(a.createdAt).getTime();
        if (tb !== ta) return tb - ta;
        const ak =
          a.kind === "transfer" ? a.idempotencyKey : a.txHash;
        const bk =
          b.kind === "transfer" ? b.idempotencyKey : b.txHash;
        return bk.localeCompare(ak);
      });

      const pageItems = items.slice(offset, offset + limit);
      const hasMore =
        pageItems.length === limit &&
        (items.length > offset + limit ||
          deposits.length === cap ||
          withdraws.length === cap ||
          transfers.length === cap);

      res.json({
        items: pageItems,
        limit,
        offset,
        hasMore,
      });
    }
  );

  router.get(
    "/user/me",
    requireAuth(env),
    async (req: AuthedRequest, res) => {
      const address = req.walletAddress!;
      const chainIdRaw = req.query.chainId;
      const parsedChainId =
        typeof chainIdRaw === "string" && /^\d+$/.test(chainIdRaw)
          ? Number(chainIdRaw)
          : undefined;

      const balances = await UserBalance.find({
        address,
        ...(parsedChainId ? { chainId: parsedChainId } : {}),
      })
        .select("currency totalAmount chainId")
        .sort({ currency: 1 })
        .lean();

      const balanceRows = balances.map((b) => ({
        currency: b.currency,
        totalAmount: b.totalAmount,
        chainId: b.chainId,
      }));
      const merged = aggregateUserBalancesForMe(balanceRows);
      const hasVaultBalance = merged.some((b) => BigInt(b.totalAmount) > 0n);

      res.json({
        address,
        balances: merged,
        hasVaultBalance,
      });
    }
  );

  return router;
}
