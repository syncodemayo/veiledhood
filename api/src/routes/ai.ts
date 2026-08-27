import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import {
  requireAuth,
  type AuthedRequest,
} from "../middleware/requireAuth.js";
import { rateLimitAi, readAiUsage } from "../middleware/rateLimit.js";
import {
  chatPrivately,
  SolRouterCallError,
} from "../services/solRouterClient.js";
import {
  computeChargeRawUsdc,
  debitShieldedUsdc,
  formatUsdcRaw,
  getShieldedUsdcBalanceRaw,
  InsufficientAiBalanceError,
  MIN_CHARGE_RAW_USDC,
} from "../services/aiBilling.js";
import { x402Gate } from "../middleware/x402.js";
import { X402_PAYMENT_SIGNATURE_HEADER } from "@shroud-fi/x402";
import { isShroudFiReady } from "../services/shroudAgent.js";
import { resolveX402AiPrice } from "../services/x402Pricing.js";

/**
 * `/ai/chat` — private inference via SolRouter (Arcium + AWS Nitro TEE),
 * routed through the API server's Tor SOCKS5 client so the inference
 * provider never observes the user's IP.
 *
 * AuthN: existing SIWE → JWT flow (`requireAuth`).
 * Quotas: per-user rolling 60s + 24h windows in Redis.
 * Logging policy: NEVER log prompt or response text. Only metadata
 * (model id, token counts, cost) is logged.
 */

function buildModelWhitelist(env: Env): string[] {
  return env.AI_MODEL_WHITELIST.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function createAiRouter(env: Env): Router {
  const router = Router();
  const modelWhitelist = buildModelWhitelist(env);
  const auth = requireAuth(env);
  const limit = rateLimitAi(env);

  const chatBodySchema = z.object({
    prompt: z.string().min(1).max(10_000),
    model: z
      .string()
      .min(1)
      .refine((m) => modelWhitelist.includes(m), {
        message: `model must be one of: ${modelWhitelist.join(", ")}`,
      }),
    systemPrompt: z.string().max(4_000).optional(),
    maxTokens: z.number().int().min(1).max(2048).optional().default(512),
  });

  router.get("/ai/config", auth, async (req: AuthedRequest, res: Response) => {
    const addr = req.walletAddress!;
    let usage: { minRemaining: number; dayRemaining: number };
    try {
      usage = await readAiUsage(env, addr);
    } catch {
      usage = {
        minRemaining: env.AI_RATE_LIMIT_PER_USER_PER_MIN,
        dayRemaining: env.AI_RATE_LIMIT_PER_USER_PER_DAY,
      };
    }
    let shieldedUsdcRaw = 0n;
    try {
      shieldedUsdcRaw = await getShieldedUsdcBalanceRaw(addr);
    } catch (e) {
      console.warn(`[veiledhood-ai] /ai/config balance read failed for ${addr.slice(0, 10)}…`, e);
    }
    res.json({
      enabled: Boolean(env.SOLROUTER_API_KEY),
      torEnabled: env.TOR_ENABLED,
      models: modelWhitelist,
      quotaPerMin: env.AI_RATE_LIMIT_PER_USER_PER_MIN,
      quotaPerDay: env.AI_RATE_LIMIT_PER_USER_PER_DAY,
      minChargeRawUsdc: MIN_CHARGE_RAW_USDC.toString(),
      shieldedUsdcRaw: shieldedUsdcRaw.toString(),
      usage,
    });
  });

  // Dispatcher: x402 (paid-per-call) when there's no JWT and x402 is configured,
  // otherwise the existing JWT/shielded-balance path. This keeps backwards
  // compat with the dapp's Private Chat tab while opening the endpoint up to
  // any x402 agent that hits /ai/chat unauth'd.
  const x402Available = isShroudFiReady(env);
  const readModel = (req: Request): string | undefined =>
    typeof req.body?.model === "string" ? req.body.model : undefined;
  const x402Stack = x402Available
    ? [
        x402Gate(env, {
          resource: "https://api.veiledhood.to/ai/chat",
          // Per-model pricing: premium models cost more upfront. Unlisted
          // models fall back to X402_PRICE_AI_CHAT_RAW_USDC. The resolved price
          // is bound to the challenge, so the paid retry must use the same
          // model it was priced for.
          priceAtomic: (req) => resolveX402AiPrice(env, readModel(req)),
          bind: (req): Record<string, string> => {
            const m = readModel(req);
            return m !== undefined ? { model: m } : {};
          },
          description: "Private AI inference (Arcium + AWS Nitro TEE)",
        }),
      ]
    : [];
  function dispatcher(req: Request, res: Response, next: NextFunction): void {
    const hasJwt =
      typeof req.headers.authorization === "string" &&
      req.headers.authorization.startsWith("Bearer ");
    const hasX402Sig =
      req.headers[X402_PAYMENT_SIGNATURE_HEADER.toLowerCase()] !== undefined;
    if (!hasJwt && x402Available) {
      // Run x402 gate first, then route to x402 handler on success.
      const stack = [...x402Stack, x402ChatHandler];
      let i = 0;
      const runNext = (): void => {
        const fn = stack[i++];
        if (fn === undefined) {
          next();
          return;
        }
        fn(req, res, runNext);
      };
      runNext();
      return;
    }
    // Existing path — auth + limit + jwt handler.
    if (hasX402Sig) {
      // Mixed signals — favor x402 path if it's available.
      if (x402Available) {
        const stack = [...x402Stack, x402ChatHandler];
        let i = 0;
        const runNext = (): void => {
          const fn = stack[i++];
          if (fn === undefined) {
            next();
            return;
          }
          fn(req, res, runNext);
        };
        runNext();
        return;
      }
    }
    auth(req as AuthedRequest, res, () => limit(req as AuthedRequest, res, () => jwtChatHandler(req as AuthedRequest, res)));
  }

  async function x402ChatHandler(req: Request, res: Response): Promise<void> {
    if (!env.SOLROUTER_API_KEY) {
      res.status(503).json({ error: "AI service is not configured" });
      return;
    }
    const parsed = chatBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }
    const payer = req.x402?.payerAddress;
    const stealth = req.x402?.stealthAddress;
    const startedAt = Date.now();
    try {
      // Use the payer address as the Tor circuit isolation key — same
      // k-anonymity property as the JWT path (one circuit per logical user).
      const result = await chatPrivately(env, {
        prompt: parsed.data.prompt,
        model: parsed.data.model,
        walletAddress: payer ?? "x402:anon",
        systemPrompt: parsed.data.systemPrompt,
        maxTokens: parsed.data.maxTokens,
      });
      const elapsedMs = Date.now() - startedAt;
      console.log(
        `[veiledhood-ai] x402-chat ok stealth=${stealth?.slice(0, 10) ?? "?"}… payer=${payer?.slice(0, 10) ?? "?"}… ` +
          `upstream_model=${result.modelUsed} requested_model=${parsed.data.model} ` +
          `tokensIn=${result.tokensIn ?? "?"} tokensOut=${result.tokensOut ?? "?"} ` +
          `cost=${result.costUsdc ?? "?"} elapsed=${elapsedMs}ms`,
      );
      res.json({
        message: result.message,
        modelUsed: parsed.data.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        elapsedMs,
        x402: {
          settledTxHash: req.x402?.settledTxHash,
          paidAtomic: req.x402?.paidAtomic.toString(),
        },
      });
    } catch (e) {
      const elapsedMs = Date.now() - startedAt;
      if (e instanceof SolRouterCallError) {
        const userMessageMap: Record<SolRouterCallError["kind"], string> = {
          auth: "Veiledhood AI service is temporarily unavailable.",
          rate_limit: "AI is busy right now. Please retry.",
          model_unavailable: "Selected model is not available right now.",
          network: "Could not reach the AI service.",
          server: "AI service is having issues.",
          unknown: "Veiledhood AI service encountered an error.",
        };
        console.warn(
          `[veiledhood-ai] x402-chat fail stealth=${stealth?.slice(0, 10) ?? "?"}… kind=${e.kind} elapsed=${elapsedMs}ms upstream="${e.message.slice(0, 200)}"`,
        );
        res.status(503).json({ error: userMessageMap[e.kind], kind: e.kind });
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[veiledhood-ai] x402-chat unexpected error elapsed=${elapsedMs}ms upstream="${msg.slice(0, 200)}"`,
      );
      res.status(500).json({ error: "Veiledhood AI service encountered an error." });
    }
  }

  const jwtChatHandler = async (req: AuthedRequest, res: Response): Promise<void> => {
    if (!env.SOLROUTER_API_KEY) {
      res.status(503).json({ error: "AI service is not configured" });
      return;
    }
    const parsed = chatBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }
    const addr = req.walletAddress!;
    const startedAt = Date.now();

    // Pre-check: require at least the minimum charge so a no-funds user can't
    // burn treasury inference time. We don't know the actual cost until after
    // the call, so we check against the floor.
    let preBalanceRaw = 0n;
    try {
      preBalanceRaw = await getShieldedUsdcBalanceRaw(addr);
    } catch (e) {
      console.error(`[veiledhood-ai] preflight balance read failed user=${addr.slice(0, 10)}…`, e);
      res.status(503).json({ error: "Could not verify shielded USDC balance. Try again." });
      return;
    }
    if (preBalanceRaw < MIN_CHARGE_RAW_USDC) {
      res.status(402).json({
        error: "Insufficient shielded USDC for AI usage. Deposit USDC on Base to continue.",
        kind: "insufficient_balance",
        shieldedUsdcRaw: preBalanceRaw.toString(),
        minChargeRawUsdc: MIN_CHARGE_RAW_USDC.toString(),
      });
      return;
    }

    try {
      const result = await chatPrivately(env, {
        prompt: parsed.data.prompt,
        model: parsed.data.model,
        walletAddress: addr,
        systemPrompt: parsed.data.systemPrompt,
        maxTokens: parsed.data.maxTokens,
      });
      const elapsedMs = Date.now() - startedAt;

      // Compute and debit. If debit fails AFTER a successful inference call we
      // log loudly but still return the response — refusing to deliver a paid
      // response is worse UX than treasury eating the rare miss.
      const chargeRaw = computeChargeRawUsdc({
        model: result.modelUsed,
        costUsdc: result.costUsdc,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      });
      let balanceAfterRaw: bigint | null = null;
      try {
        const debit = await debitShieldedUsdc(addr, chargeRaw);
        balanceAfterRaw = debit.after;
      } catch (debitErr) {
        if (debitErr instanceof InsufficientAiBalanceError) {
          // Caller passed the pre-check but the actual charge exceeded balance
          // (rare — only when actual cost > MIN_CHARGE_RAW_USDC and user's
          // balance fell between pre-check and debit). Treasury absorbs.
          console.error(
            `[veiledhood-ai] BILLING_INSUFFICIENT user=${addr.slice(0, 10)}… ` +
              `have=${debitErr.have.toString()} need=${debitErr.need.toString()}`,
          );
        } else {
          console.error(
            `[veiledhood-ai] BILLING_ERROR user=${addr.slice(0, 10)}… charge=${chargeRaw.toString()} err=${debitErr instanceof Error ? debitErr.message : String(debitErr)}`,
          );
        }
      }

      // Metadata-only log — prompt and response text are NEVER persisted.
      console.log(
        `[veiledhood-ai] chat ok user=${addr.slice(0, 10)}… upstream_model=${result.modelUsed} ` +
          `requested_model=${parsed.data.model} ` +
          `tokensIn=${result.tokensIn ?? "?"} tokensOut=${result.tokensOut ?? "?"} ` +
          `cost=${result.costUsdc ?? "?"} charge=${formatUsdcRaw(chargeRaw)} elapsed=${elapsedMs}ms`,
      );
      // Surface the model id the user picked, not the upstream provider's
      // internal routing identifier (e.g. "nosana:gpt-oss:20b" → "gpt-oss-20b").
      res.json({
        message: result.message,
        modelUsed: parsed.data.model,
        chargeRawUsdc: chargeRaw.toString(),
        balanceAfterRawUsdc: balanceAfterRaw !== null ? balanceAfterRaw.toString() : null,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        elapsedMs,
      });
    } catch (e) {
      const elapsedMs = Date.now() - startedAt;
      if (e instanceof SolRouterCallError) {
        const statusMap: Record<SolRouterCallError["kind"], number> = {
          auth: 502,
          rate_limit: 429,
          model_unavailable: 503,
          network: 503,
          server: 503,
          unknown: 502,
        };
        // User-facing messages are scrubbed of any reference to the upstream
        // inference provider — Veiledhood's positioning is that AI calls are
        // routed through a private TEE, full stop. Server logs keep the raw
        // upstream text for ops debugging.
        const userMessageMap: Record<SolRouterCallError["kind"], string> = {
          auth: "Veiledhood AI service is temporarily unavailable. Please try again later.",
          rate_limit: "AI is busy right now. Please retry in a moment.",
          model_unavailable:
            "Selected model is not available right now. Try a different model.",
          network: "Could not reach the AI service. Please retry shortly.",
          server: "AI service is having issues. Please try again shortly.",
          unknown: "Veiledhood AI service encountered an error. Please try again.",
        };
        const status = statusMap[e.kind];
        console.warn(
          `[veiledhood-ai] chat fail user=${addr.slice(0, 10)}… kind=${e.kind} elapsed=${elapsedMs}ms upstream="${e.message.slice(0, 200)}"`,
        );
        res.status(status).json({
          error: userMessageMap[e.kind],
          kind: e.kind,
        });
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[veiledhood-ai] chat unexpected error user=${addr.slice(0, 10)}… elapsed=${elapsedMs}ms upstream="${msg.slice(0, 200)}"`,
      );
      res.status(500).json({ error: "Veiledhood AI service encountered an error. Please try again." });
    }
  };

  router.post("/ai/chat", dispatcher);

  return router;
}
