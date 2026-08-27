import { Router } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import {
  requireAuth,
  type AuthedRequest,
} from "../middleware/requireAuth.js";
import {
  InsufficientBalanceError,
  recordWithdraw,
} from "../services/recordWithdraw.js";
import { DEFAULT_BASE_CHAIN_ID } from "../util/chainLedger.js";

const recordBodySchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  currency: z.string().trim().min(1),
  amount: z
    .string()
    .regex(/^\d+$/)
    .refine((s) => BigInt(s) > 0n, "amount must be positive"),
  chainId: z.coerce.number().int().positive().optional(),
});

export function createWithdrawsRouter(env: Env): Router {
  const router = Router();

  router.post(
    "/withdraws",
    requireAuth(env),
    async (req: AuthedRequest, res) => {
      const parsed = recordBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid body",
          details: parsed.error.flatten(),
        });
        return;
      }

      const wallet = req.walletAddress!;
      const { txHash, currency, amount } = parsed.data;
      const chainId = parsed.data.chainId ?? env.CHAIN_ID ?? DEFAULT_BASE_CHAIN_ID;
      const txLower = txHash.toLowerCase();

      try {
        const result = await recordWithdraw({
          address: wallet,
          chainId,
          currency,
          amount,
          txHash: txLower,
        });

        if (result.status === "duplicate") {
          res.status(200).json({
            status: "duplicate",
            address: wallet,
            currency,
            chainId,
            amount,
            txHash: txLower,
          });
          return;
        }

        res.status(201).json({
          status: "created",
          withdrawId: result.withdrawId,
          address: wallet,
          currency,
          chainId,
          amount,
          txHash: txLower,
        });
      } catch (e) {
        if (e instanceof InsufficientBalanceError) {
          res.status(400).json({ error: "Insufficient balance" });
          return;
        }
        const message = e instanceof Error ? e.message : String(e);
        console.error("[POST /withdraws]", message, e);
        res.status(500).json({
          error: "Failed to record withdraw",
          message,
        });
      }
    }
  );

  return router;
}
