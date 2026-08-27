import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import type { Env } from "../config/env.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { rateLimitBridge } from "../middleware/rateLimit.js";
import { Bridge } from "../models/Bridge.js";
import { nextEscrowNonce } from "../services/bridgeNonce.js";
import { createDeBridgeClient } from "../services/deBridgeClient.js";
import { applyVeiledhoodBridgeFee } from "../services/bridgeFeeQuote.js";
import { ledgerCurrencyToMerkleToken } from "../services/ledgerLeaves.js";
import { resolveDestBridgeCurrency } from "../services/bridgeTokenMap.js";
import { makeBridgeExecutor } from "../services/bridgeExecutor.js";
import { driveBridge } from "../services/bridgeOrchestrator.js";
import { NATIVE_CURRENCY_KEY } from "../constants/currency.js";

const currencySchema = z
  .string()
  .trim()
  .refine(
    (s) => /^0x[a-fA-F0-9]{40}$/.test(s) || s.toLowerCase() === NATIVE_CURRENCY_KEY,
    `currency must be a token address or '${NATIVE_CURRENCY_KEY}'`
  );

const quoteSchema = z.object({
  sourceChainId: z.coerce.number().int().positive(),
  destChainId: z.coerce.number().int().positive(),
  currency: currencySchema,
  amount: z.string().regex(/^\d+$/).refine((s) => BigInt(s) > 0n, "amount must be positive"),
});

const createSchema = quoteSchema; // same inputs; user derived from auth

export function createBridgeRouter(env: Env): Router {
  const router = Router();
  const base = env.CHAIN_ID ?? env.BASE_CHAIN_ID ?? 8453;
  const eth = env.ETH_CHAIN_ID ?? 1;

  function ensureEnabledAndSupported(
    res: import("express").Response,
    sourceChainId: number,
    destChainId: number
  ): boolean {
    if (!env.BRIDGE_ENABLED) {
      res.status(503).json({ error: "Bridging is not enabled" });
      return false;
    }
    const ok =
      (sourceChainId === base && destChainId === eth) ||
      (sourceChainId === eth && destChainId === base);
    if (!ok) {
      res.status(400).json({ error: "Only Base<->Eth bridging is supported" });
      return false;
    }
    return true;
  }

  // POST /bridge/fee-quote
  router.post("/bridge/fee-quote", requireAuth(env), async (req: AuthedRequest, res) => {
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid quote request", details: parsed.error.flatten() });
      return;
    }
    const { sourceChainId, destChainId, currency, amount } = parsed.data;
    if (!ensureEnabledAndSupported(res, sourceChainId, destChainId)) return;

    try {
      const deBridge = createDeBridgeClient({
        apiUrl: env.DEBRIDGE_API_URL,
        statsApiUrl: env.DEBRIDGE_STATS_API_URL,
        referralCode: env.DEBRIDGE_REFERRAL_CODE,
      });
      const srcToken = ledgerCurrencyToMerkleToken(currency);
      const destCurrency = resolveDestBridgeCurrency(currency, sourceChainId, destChainId);
      const dstToken = ledgerCurrencyToMerkleToken(destCurrency);
      const q = await deBridge.quote({
        srcChainId: sourceChainId,
        srcTokenIn: srcToken,
        srcAmountIn: amount,
        dstChainId: destChainId,
        dstTokenOut: dstToken,
      });
      const fee = applyVeiledhoodBridgeFee({
        amountIn: BigInt(amount),
        deBridgeOut: BigInt(q.dstAmountOut),
        feeBps: env.BRIDGE_FEE_BPS,
      });
      res.json({
        sourceChainId,
        destChainId,
        currency,
        amount,
        deBridgeOut: q.dstAmountOut,
        veiledhoodFee: fee.veiledhoodFee.toString(),
        recipientReceives: fee.recipientReceives.toString(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(502).json({ error: "Quote failed", detail: msg });
    }
  });

  // POST /bridge — create + kick off
  router.post("/bridge", requireAuth(env), rateLimitBridge(env), async (req: AuthedRequest, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid bridge request", details: parsed.error.flatten() });
      return;
    }
    const { sourceChainId, destChainId, currency, amount } = parsed.data;
    if (!ensureEnabledAndSupported(res, sourceChainId, destChainId)) return;
    const addr = req.walletAddress!;

    const bridgeId = `brg_${crypto.randomUUID()}`;
    const escrowNonce = await nextEscrowNonce();
    await Bridge.create({
      bridgeId,
      userAddress: addr.toLowerCase(),
      sourceChainId,
      destChainId,
      currency: currency.toLowerCase(),
      amountRequested: amount,
      escrowNonce,
      status: "created",
    });

    // Kick the orchestrator in the background; the client polls GET /bridge/:id.
    void driveBridge(bridgeId, makeBridgeExecutor(env)).catch((e) => {
      console.error(`[veiledhood-bridge] driveBridge ${bridgeId} failed:`, e);
    });

    res.status(202).json({ bridgeId, status: "created" });
  });

  // GET /bridge/:id — status
  router.get("/bridge/:id", requireAuth(env), async (req: AuthedRequest, res) => {
    const addr = req.walletAddress!;
    const doc = await Bridge.findOne({ bridgeId: req.params.id })
      .select(
        "bridgeId userAddress status amountRequested amountReceived sourceChainId destChainId currency error createdAt"
      )
      .lean<{
        bridgeId: string; userAddress: string; status: string;
        amountRequested: string; amountReceived?: string;
        sourceChainId: number; destChainId: number; currency: string;
        error?: string; createdAt: Date;
      } | null>();
    if (!doc || doc.userAddress !== addr.toLowerCase()) {
      res.status(404).json({ error: "Bridge not found" });
      return;
    }
    res.json(doc);
  });

  return router;
}
