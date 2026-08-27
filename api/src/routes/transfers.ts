import { Router } from "express";
import { ethers } from "ethers";
import { z } from "zod";
import type { Env } from "../config/env.js";
import {
  requireAuth,
  type AuthedRequest,
} from "../middleware/requireAuth.js";
import {
  executeTransferWithMerklePayout,
  resumeTransferMerklePayoutIfNeeded,
  TransferPayoutNotConfiguredError,
} from "../services/transferMerklePayout.js";
import {
  InsufficientBalanceError,
  TransferTreasuryRecipientError,
  recordTransfer,
} from "../services/recordTransfer.js";
import { computeTransferFeeBreakdown } from "../util/transferFees.js";
import { getTransferFeeConfigForCurrency } from "../util/transferFeeConfig.js";
import {
  DEFAULT_BASE_CHAIN_ID,
  DEFAULT_ETH_CHAIN_ID,
} from "../util/chainLedger.js";

const feeQuoteQuerySchema = z.object({
  amount: z
    .string()
    .regex(/^\d+$/)
    .refine((s) => BigInt(s) > 0n, "amount must be positive"),
  currency: z.string().trim().min(1),
  chainId: z.coerce.number().int().positive().optional(),
});

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/, "idempotencyKey must be alphanumeric (dash/underscore ok)");

const transferBodySchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  currency: z.string().trim().min(1),
  amount: z
    .string()
    .regex(/^\d+$/)
    .refine((s) => BigInt(s) > 0n, "amount must be positive"),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.coerce.number().int().positive().optional(),
});


export function createTransfersRouter(env: Env): Router {
  const router = Router();

  router.get("/transfers/fee-quote", (req, res) => {
    let rawAmount: string | undefined;
    const qa = req.query.amount;
    if (typeof qa === "string") rawAmount = qa;
    else if (Array.isArray(qa) && typeof qa[0] === "string") rawAmount = qa[0];
    let rawCurrency: string | undefined;
    const qc = req.query.currency;
    if (typeof qc === "string") rawCurrency = qc;
    else if (Array.isArray(qc) && typeof qc[0] === "string") rawCurrency = qc[0];
    let rawChainId: string | undefined;
    const qChain = req.query.chainId;
    if (typeof qChain === "string") rawChainId = qChain;
    else if (Array.isArray(qChain) && typeof qChain[0] === "string") rawChainId = qChain[0];

    const parsed = feeQuoteQuerySchema.safeParse({
      amount: rawAmount,
      currency: rawCurrency,
      chainId: rawChainId,
    });
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid query",
        details: parsed.error.flatten(),
      });
      return;
    }

    const amountStr = parsed.data.amount;
    const currency = parsed.data.currency;
    const amountBn = BigInt(amountStr);
    const chainId = parsed.data.chainId ?? DEFAULT_BASE_CHAIN_ID;
    const { fixed, bps } =
      chainId === (env.ETH_CHAIN_ID ?? DEFAULT_ETH_CHAIN_ID)
        ? {
            fixed: BigInt(env.VEILEDHOOD_ETH_TRANSFER_FEE_FIXED ?? "0"),
            bps: env.VEILEDHOOD_ETH_TRANSFER_FEE_BPS ?? 0,
          }
        : getTransferFeeConfigForCurrency(env, currency);
    const { fixedFee, bpsFee, totalFees } = computeTransferFeeBreakdown(
      amountBn,
      fixed,
      bps
    );

    res.status(200).json({
      amount: amountStr,
      currency,
      chainId,
      recipientReceives: amountStr,
      fees: {
        fixed: fixedFee.toString(),
        bps,
        bpsFee: bpsFee.toString(),
        total: totalFees.toString(),
      },
      senderTotalDebit: (amountBn + totalFees).toString(),
    });
  });

  router.post(
    "/transfers",
    requireAuth(env),
    async (req: AuthedRequest, res) => {
      const parsed = transferBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid body",
          details: parsed.error.flatten(),
        });
        return;
      }

      const fromAddress = req.walletAddress!;
      let toAddress: string;
      try {
        toAddress = ethers.getAddress(parsed.data.to).toLowerCase();
      } catch {
        res.status(400).json({ error: "Invalid recipient address" });
        return;
      }

      const { idempotencyKey, currency, amount } = parsed.data;
      const chainId = parsed.data.chainId ?? env.CHAIN_ID ?? DEFAULT_BASE_CHAIN_ID;
      const feeCfg = getTransferFeeConfigForCurrency(env, currency);

      try {
        let result = await executeTransferWithMerklePayout({
          env,
          fromAddress,
          toAddress,
          currency,
          amount,
          idempotencyKey,
          feeConfig: {
            fixed: feeCfg.fixed,
            bps: feeCfg.bps,
            treasuryLedgerAddress: feeCfg.treasuryLedgerAddress,
          },
        });

        if (
          result.kind === "duplicate" &&
          !result.chain?.adminWithdrawTxHash
        ) {
          const resumed = await resumeTransferMerklePayoutIfNeeded(
            env,
            idempotencyKey
          );
          if (resumed) {
            result = {
              kind: "created",
              transferId: result.transferId,
              chain: resumed,
            };
          }
        }

        if (result.kind === "duplicate") {
          res.status(200).json({
            status: "duplicate",
            transferId: result.transferId,
            from: fromAddress,
            to: toAddress,
            currency,
            amount,
            idempotencyKey,
            chainId,
            ...(result.chain && { chain: result.chain }),
          });
          return;
        }

        res.status(201).json({
          status: "created",
          transferId: result.transferId,
          from: fromAddress,
          to: toAddress,
          currency,
          amount,
          idempotencyKey,
          chainId,
          chain: result.chain,
        });
      } catch (e) {
        if (e instanceof InsufficientBalanceError) {
          res.status(400).json({ error: "Insufficient balance" });
          return;
        }
        if (e instanceof Error && e.message === "Self-transfer is not allowed") {
          res.status(400).json({ error: e.message });
          return;
        }
        if (e instanceof TransferTreasuryRecipientError) {
          res.status(400).json({ error: e.message });
          return;
        }
        if (e instanceof TransferPayoutNotConfiguredError) {
          res.status(503).json({ error: e.message });
          return;
        }
        const message = e instanceof Error ? e.message : String(e);
        console.error("[POST /transfers]", message, e);
        res.status(500).json({
          error: "Failed to record transfer",
          message,
        });
      }
    }
  );

  router.post(
    "/eth/transfers",
    requireAuth(env),
    async (req: AuthedRequest, res) => {
      const parsed = transferBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
        return;
      }

      const rpc = env.ETH_RPC_URL?.trim();
      const vault = env.ETH_VAULT_ADDRESS?.trim();
      if (!rpc || !vault || !env.ADMIN_PRIVATE_KEY?.trim() || !env.SIGNER_PRIVATE_KEY?.trim()) {
        res.status(503).json({ error: "ETH chain not configured" });
        return;
      }

      const fromAddress = req.walletAddress!;
      let toAddress: string;
      try {
        toAddress = ethers.getAddress(parsed.data.to).toLowerCase();
      } catch {
        res.status(400).json({ error: "Invalid recipient address" });
        return;
      }

      const { idempotencyKey, currency, amount } = parsed.data;
      const chainId = parsed.data.chainId ?? env.ETH_CHAIN_ID ?? DEFAULT_ETH_CHAIN_ID;
      const ethFixed = env.VEILEDHOOD_ETH_TRANSFER_FEE_FIXED ? BigInt(env.VEILEDHOOD_ETH_TRANSFER_FEE_FIXED) : 0n;
      const ethBps = env.VEILEDHOOD_ETH_TRANSFER_FEE_BPS ?? 0;
      const feeCfg = getTransferFeeConfigForCurrency(env, currency);

      const ethEnv = { ...env, RPC_URL: rpc, VAULT_ADDRESS: vault, CHAIN_ID: chainId };

      try {
        let result = await executeTransferWithMerklePayout({
          env: ethEnv,
          fromAddress,
          toAddress,
          currency,
          amount,
          idempotencyKey,
          feeConfig: {
            fixed: ethFixed,
            bps: ethBps,
            treasuryLedgerAddress: feeCfg.treasuryLedgerAddress,
          },
        });

        if (result.kind === "duplicate" && !result.chain?.adminWithdrawTxHash) {
          const resumed = await resumeTransferMerklePayoutIfNeeded(ethEnv, idempotencyKey);
          if (resumed) {
            result = { kind: "created", transferId: result.transferId, chain: resumed };
          }
        }

        if (result.kind === "duplicate") {
          res.status(200).json({
            status: "duplicate",
            transferId: result.transferId,
            from: fromAddress,
            to: toAddress,
            currency,
            amount,
            idempotencyKey,
            chainId,
            ...(result.chain && { chain: result.chain }),
          });
          return;
        }

        res.status(201).json({
          status: "created",
          transferId: result.transferId,
          from: fromAddress,
          to: toAddress,
          currency,
          amount,
          idempotencyKey,
          chainId,
          chain: result.chain,
        });
      } catch (e) {
        if (e instanceof InsufficientBalanceError) {
          res.status(400).json({ error: "Insufficient balance" });
          return;
        }
        if (e instanceof Error && e.message === "Self-transfer is not allowed") {
          res.status(400).json({ error: e.message });
          return;
        }
        if (e instanceof TransferTreasuryRecipientError) {
          res.status(400).json({ error: e.message });
          return;
        }
        if (e instanceof TransferPayoutNotConfiguredError) {
          res.status(503).json({ error: e.message });
          return;
        }
        const message = e instanceof Error ? e.message : String(e);
        console.error("[POST /eth/transfers]", message, e);
        res.status(500).json({ error: "Failed to execute ETH transfer", message });
      }
    }
  );

  return router;
}
