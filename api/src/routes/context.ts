import { Router } from "express";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { rateLimitContext } from "../middleware/rateLimit.js";
import {
  createPooledRpcProxy,
  type PooledRpcProxy,
} from "../services/pooledRpcProxy.js";
import {
  createPriceOracle,
  type PriceOracle,
} from "../services/priceOracle.js";
import {
  createWalletContextAggregator,
  type WalletContextAggregator,
} from "../services/walletContextAggregator.js";
import { getRedis } from "../middleware/rateLimit.js";
import { isSupportedChain } from "../util/tokenLists.js";
import { base } from "viem/chains";

/**
 * Wallet-context routes (Phase 3):
 *   POST /context/shielded  — Mongo-backed shielded balances + USD enrichment
 *   POST /context/public    — pooled-RPC + multicall public balances
 *   POST /context/full      — both, combined
 *
 * All routes require JWT auth (requireAuth) and are per-user rate-limited
 * via the dedicated `context:rl:` Redis namespace.
 *
 * Privacy posture: the address is read from the JWT (not from the request
 * body) so untrusted callers cannot query someone else's wallet. Responses
 * include the address solely for echo/sanity — never as new information.
 */

const contextBodySchema = z.object({
  chainId: z.coerce.number().int().positive().optional(),
});

export interface CreateContextRouterDeps {
  /** Test-only override — swap pooled proxy with a mock. */
  readonly proxy?: PooledRpcProxy;
  /** Test-only override — swap price oracle with a mock. */
  readonly oracle?: PriceOracle;
  /** Test-only override — provide a pre-built aggregator. */
  readonly aggregator?: WalletContextAggregator;
}

export function createContextRouter(env: Env, deps: CreateContextRouterDeps = {}): Router {
  const router = Router();

  // Wire production services unless a test override is supplied
  const proxy = deps.proxy ?? createPooledRpcProxy(env);
  const oracle =
    deps.oracle ??
    createPriceOracle(env, {
      redis: env.CONTEXT_RATE_LIMIT_DISABLED ? undefined : getRedis(env),
    });
  const aggregator =
    deps.aggregator ?? createWalletContextAggregator(env, { proxy, oracle });

  function resolveChainId(body: unknown): { ok: true; chainId: number } | { ok: false; error: string } {
    const parsed = contextBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      return { ok: false, error: "Invalid body" };
    }
    const chainId = parsed.data.chainId ?? env.BASE_CHAIN_ID ?? base.id;
    if (!isSupportedChain(chainId)) {
      return { ok: false, error: `Unsupported chain: ${chainId}` };
    }
    return { ok: true, chainId };
  }

  router.post(
    "/context/shielded",
    requireAuth(env),
    rateLimitContext(env),
    async (req: AuthedRequest, res) => {
      const address = req.walletAddress!;
      const chainResolution = resolveChainId(req.body);
      if (!chainResolution.ok) {
        res.status(400).json({ error: chainResolution.error });
        return;
      }
      try {
        const payload = await aggregator.getShielded(address, chainResolution.chainId);
        res.json(payload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "shielded context failed";
        // Never echo the holder address in error responses
        console.warn("[veiledhood-context] /shielded error:", msg);
        res.status(500).json({ error: "Internal error fetching shielded context" });
      }
    },
  );

  router.post(
    "/context/public",
    requireAuth(env),
    rateLimitContext(env),
    async (req: AuthedRequest, res) => {
      const address = req.walletAddress!;
      const chainResolution = resolveChainId(req.body);
      if (!chainResolution.ok) {
        res.status(400).json({ error: chainResolution.error });
        return;
      }
      try {
        const payload = await aggregator.getPublic(address, chainResolution.chainId);
        res.json(payload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "public context failed";
        console.warn("[veiledhood-context] /public error:", msg);
        res.status(503).json({ error: "Public context temporarily unavailable" });
      }
    },
  );

  router.post(
    "/context/full",
    requireAuth(env),
    rateLimitContext(env),
    async (req: AuthedRequest, res) => {
      const address = req.walletAddress!;
      const chainResolution = resolveChainId(req.body);
      if (!chainResolution.ok) {
        res.status(400).json({ error: chainResolution.error });
        return;
      }
      try {
        const payload = await aggregator.getFull(address, chainResolution.chainId);
        res.json(payload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "full context failed";
        console.warn("[veiledhood-context] /full error:", msg);
        res.status(503).json({ error: "Wallet context temporarily unavailable" });
      }
    },
  );

  return router;
}
