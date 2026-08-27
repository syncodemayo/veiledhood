import { Router } from "express";
import type { Env } from "../config/env.js";
import { getRedis } from "../middleware/rateLimit.js";
import {
  createPooledRpcProxy,
  type PooledRpcProxy,
} from "../services/pooledRpcProxy.js";
import {
  createPriceOracle,
  type PriceOracle,
} from "../services/priceOracle.js";

/**
 * /health/context — green only if every leg of the wallet-context request
 * path is reachable:
 *   - Redis (rate-limit + price cache)
 *   - Pyth Hermes
 *   - CoinGecko (fallback)
 *   - pooledRpcProxy reports `ok` per chain
 *
 * Lightweight checks. Does NOT issue a multicall or burn paid RPC.
 */
export interface CreateContextHealthRouterDeps {
  readonly proxy?: PooledRpcProxy;
  readonly oracle?: PriceOracle;
}

export function createContextHealthRouter(
  env: Env,
  deps: CreateContextHealthRouterDeps = {},
): Router {
  const router = Router();

  const proxy = deps.proxy ?? createPooledRpcProxy(env);
  const oracle = deps.oracle ?? createPriceOracle(env);

  router.get("/health/context", async (_req, res) => {
    const checks: Record<string, { ok: boolean; detail?: string | object }> = {};

    // Redis ping
    try {
      const redis = getRedis(env);
      const pong = await redis.ping();
      checks.redis = { ok: pong === "PONG", detail: pong };
    } catch (e) {
      checks.redis = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }

    // Pooled RPC proxy
    try {
      const h = await proxy.health();
      checks.rpc = { ok: h.ok, detail: h.chains };
    } catch (e) {
      checks.rpc = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }

    // Price oracle (Pyth + CoinGecko)
    try {
      const h = await oracle.health();
      checks.pyth = { ok: h.pyth, detail: h.pyth ? "reachable" : "unreachable" };
      checks.coingecko = {
        ok: h.coingecko,
        detail: h.coingecko ? "reachable" : "unreachable",
      };
    } catch (e) {
      checks.pyth = { ok: false, detail: e instanceof Error ? e.message : String(e) };
      checks.coingecko = { ok: false, detail: "unreachable" };
    }

    // Context is healthy if Redis + RPC + at least one price source are up
    const ok =
      Boolean(checks.redis.ok) &&
      Boolean(checks.rpc.ok) &&
      (Boolean(checks.pyth.ok) || Boolean(checks.coingecko.ok));
    res.status(ok ? 200 : 503).json({
      status: ok ? "ok" : "degraded",
      checks,
      config: {
        batchWindowMs: env.RPC_POOL_BATCH_WINDOW_MS,
        decoyRatio: env.RPC_POOL_DECOY_RATIO,
        cacheTtlS: env.CONTEXT_CACHE_TTL_S,
      },
    });
  });

  return router;
}
