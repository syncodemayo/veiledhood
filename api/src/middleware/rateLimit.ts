import type { Response, NextFunction } from "express";
import { Redis } from "ioredis";
import type { Env } from "../config/env.js";
import type { AuthedRequest } from "./requireAuth.js";

/**
 * Per-user rate limit backed by Redis using INCR + EXPIRE windows.
 * Two limits enforced per request: rolling 60s burst and rolling 24h quota.
 * Limits are per JWT subject (wallet address).
 *
 * Headers on every response:
 *   X-Veiledhood-Quota-Min-Remaining
 *   X-Veiledhood-Quota-Day-Remaining
 *
 * On rejection: 429 with `Retry-After` (seconds) header.
 */

let cachedRedis: Redis | null = null;

export function getRedis(env: Env): Redis {
  if (cachedRedis) return cachedRedis;
  cachedRedis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
    enableReadyCheck: true,
  });
  cachedRedis.on("error", (err: Error) => {
    console.error("[veiledhood-redis] error:", err.message);
  });
  return cachedRedis;
}

interface BucketResult {
  allowed: boolean;
  remainingMin: number;
  remainingDay: number;
  resetMinSec: number;
}

interface BucketConfig {
  keyPrefix: string;
  minLimit: number;
  dayLimit: number;
}

async function checkBucketsWithConfig(
  env: Env,
  walletAddress: string,
  cfg: BucketConfig,
): Promise<BucketResult> {
  const redis = getRedis(env);
  const minKey = `${cfg.keyPrefix}min:${walletAddress}`;
  const dayKey = `${cfg.keyPrefix}day:${walletAddress}`;

  const execResult = await redis.multi().incr(minKey).incr(dayKey).exec();
  if (!execResult) throw new Error("redis multi returned null");
  const [minCountRaw, dayCountRaw] = execResult.map(
    (entry: [Error | null, unknown]) => Number(entry[1]),
  );

  const minCount = Number(minCountRaw);
  const dayCount = Number(dayCountRaw);

  // Set TTLs on first hit of the window (count === 1 right after INCR).
  if (minCount === 1) await redis.expire(minKey, 60);
  if (dayCount === 1) await redis.expire(dayKey, 86400);

  const minTtl = await redis.ttl(minKey);
  const minLimit = cfg.minLimit;
  const dayLimit = cfg.dayLimit;

  if (minCount > minLimit || dayCount > dayLimit) {
    // Roll back the over-count so subsequent calls still see accurate state.
    await redis
      .multi()
      .decr(minKey)
      .decr(dayKey)
      .exec();
    return {
      allowed: false,
      remainingMin: Math.max(0, minLimit - (minCount - 1)),
      remainingDay: Math.max(0, dayLimit - (dayCount - 1)),
      resetMinSec: minTtl > 0 ? minTtl : 60,
    };
  }

  return {
    allowed: true,
    remainingMin: Math.max(0, minLimit - minCount),
    remainingDay: Math.max(0, dayLimit - dayCount),
    resetMinSec: minTtl > 0 ? minTtl : 60,
  };
}

async function checkBuckets(
  env: Env,
  walletAddress: string,
): Promise<BucketResult> {
  return checkBucketsWithConfig(env, walletAddress, {
    keyPrefix: "ai:rl:",
    minLimit: env.AI_RATE_LIMIT_PER_USER_PER_MIN,
    dayLimit: env.AI_RATE_LIMIT_PER_USER_PER_DAY,
  });
}

export function rateLimitAi(env: Env) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (env.AI_RATE_LIMIT_DISABLED) {
      next();
      return;
    }
    const addr = req.walletAddress;
    if (!addr) {
      res.status(401).json({ error: "Missing wallet address from auth" });
      return;
    }
    try {
      const bucket = await checkBuckets(env, addr);
      res.setHeader("X-Veiledhood-Quota-Min-Remaining", String(bucket.remainingMin));
      res.setHeader("X-Veiledhood-Quota-Day-Remaining", String(bucket.remainingDay));
      if (!bucket.allowed) {
        res.setHeader("Retry-After", String(bucket.resetMinSec));
        res.status(429).json({
          error: "Rate limit exceeded",
          retryAfterSec: bucket.resetMinSec,
          minRemaining: bucket.remainingMin,
          dayRemaining: bucket.remainingDay,
        });
        return;
      }
      next();
    } catch (e) {
      // Fail-open on Redis outage rather than block all AI traffic.
      console.warn("[veiledhood-ai] rate-limit check failed, allowing request:", e);
      next();
    }
  };
}

/**
 * Best-effort current usage probe for the chat UI's "X / Y left" indicator.
 * Reads counters without incrementing.
 */
export async function readAiUsage(
  env: Env,
  walletAddress: string,
): Promise<{ minRemaining: number; dayRemaining: number }> {
  if (env.AI_RATE_LIMIT_DISABLED) {
    return {
      minRemaining: env.AI_RATE_LIMIT_PER_USER_PER_MIN,
      dayRemaining: env.AI_RATE_LIMIT_PER_USER_PER_DAY,
    };
  }
  const redis = getRedis(env);
  const minKey = `ai:rl:min:${walletAddress}`;
  const dayKey = `ai:rl:day:${walletAddress}`;
  const [minRaw, dayRaw] = await redis.mget(minKey, dayKey);
  const minUsed = Number(minRaw ?? 0);
  const dayUsed = Number(dayRaw ?? 0);
  return {
    minRemaining: Math.max(0, env.AI_RATE_LIMIT_PER_USER_PER_MIN - minUsed),
    dayRemaining: Math.max(0, env.AI_RATE_LIMIT_PER_USER_PER_DAY - dayUsed),
  };
}

/**
 * Per-user rate limit for the encrypted-agents CRUD endpoints. Same shape
 * and fail-open posture as `rateLimitAi`, but a distinct `agents:rl:` key
 * namespace and its own min/day limits so agent traffic can't burn the AI
 * quota and vice-versa.
 */
export function rateLimitAgents(env: Env) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (env.AGENTS_RATE_LIMIT_DISABLED) {
      next();
      return;
    }
    const addr = req.walletAddress;
    if (!addr) {
      res.status(401).json({ error: "Missing wallet address from auth" });
      return;
    }
    try {
      const bucket = await checkBucketsWithConfig(env, addr, {
        keyPrefix: "agents:rl:",
        minLimit: env.AGENTS_RATE_LIMIT_PER_USER_PER_MIN,
        dayLimit: env.AGENTS_RATE_LIMIT_PER_USER_PER_DAY,
      });
      res.setHeader("X-Veiledhood-Quota-Min-Remaining", String(bucket.remainingMin));
      res.setHeader("X-Veiledhood-Quota-Day-Remaining", String(bucket.remainingDay));
      if (!bucket.allowed) {
        res.setHeader("Retry-After", String(bucket.resetMinSec));
        res.status(429).json({
          error: "Rate limit exceeded",
          retryAfterSec: bucket.resetMinSec,
          minRemaining: bucket.remainingMin,
          dayRemaining: bucket.remainingDay,
        });
        return;
      }
      next();
    } catch (e) {
      // Fail-open on Redis outage rather than block all agent traffic.
      console.warn("[veiledhood-agents] rate-limit check failed, allowing request:", e);
      next();
    }
  };
}

/** Per-user rate limit for bridging. Distinct `bridge:rl:` namespace; day limit
 *  = BRIDGE_USER_DAILY_QUOTA, with a small per-minute burst. */
export function rateLimitBridge(env: Env) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const addr = req.walletAddress;
    if (!addr) {
      res.status(401).json({ error: "Missing wallet address from auth" });
      return;
    }
    try {
      const bucket = await checkBucketsWithConfig(env, addr, {
        keyPrefix: "bridge:rl:",
        minLimit: 3,
        dayLimit: env.BRIDGE_USER_DAILY_QUOTA,
      });
      res.setHeader("X-Veiledhood-Quota-Min-Remaining", String(bucket.remainingMin));
      res.setHeader("X-Veiledhood-Quota-Day-Remaining", String(bucket.remainingDay));
      if (!bucket.allowed) {
        res.setHeader("Retry-After", String(bucket.resetMinSec));
        res.status(429).json({
          error: "Rate limit exceeded",
          retryAfterSec: bucket.resetMinSec,
          minRemaining: bucket.remainingMin,
          dayRemaining: bucket.remainingDay,
        });
        return;
      }
      next();
    } catch (e) {
      console.warn("[veiledhood-bridge] rate-limit check failed, allowing request:", e);
      next();
    }
  };
}

/**
 * Best-effort current usage probe for the agents CRUD quota indicator.
 * Reads counters without incrementing.
 */
export async function readAgentsUsage(
  env: Env,
  walletAddress: string,
): Promise<{ minRemaining: number; dayRemaining: number }> {
  if (env.AGENTS_RATE_LIMIT_DISABLED) {
    return {
      minRemaining: env.AGENTS_RATE_LIMIT_PER_USER_PER_MIN,
      dayRemaining: env.AGENTS_RATE_LIMIT_PER_USER_PER_DAY,
    };
  }
  const redis = getRedis(env);
  const minKey = `agents:rl:min:${walletAddress}`;
  const dayKey = `agents:rl:day:${walletAddress}`;
  const [minRaw, dayRaw] = await redis.mget(minKey, dayKey);
  const minUsed = Number(minRaw ?? 0);
  const dayUsed = Number(dayRaw ?? 0);
  return {
    minRemaining: Math.max(0, env.AGENTS_RATE_LIMIT_PER_USER_PER_MIN - minUsed),
    dayRemaining: Math.max(0, env.AGENTS_RATE_LIMIT_PER_USER_PER_DAY - dayUsed),
  };
}

/**
 * Per-user rate limit for the wallet-context endpoints (Phase 3). Same shape
 * as `rateLimitAi`/`rateLimitAgents` with a dedicated `context:rl:` Redis
 * namespace so context traffic can't burn AI or agents quota and vice versa.
 */
export function rateLimitContext(env: Env) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (env.CONTEXT_RATE_LIMIT_DISABLED) {
      next();
      return;
    }
    const addr = req.walletAddress;
    if (!addr) {
      res.status(401).json({ error: "Missing wallet address from auth" });
      return;
    }
    try {
      const bucket = await checkBucketsWithConfig(env, addr, {
        keyPrefix: "context:rl:",
        minLimit: env.CONTEXT_RATE_LIMIT_PER_USER_PER_MIN,
        dayLimit: env.CONTEXT_RATE_LIMIT_PER_USER_PER_DAY,
      });
      res.setHeader("X-Veiledhood-Quota-Min-Remaining", String(bucket.remainingMin));
      res.setHeader("X-Veiledhood-Quota-Day-Remaining", String(bucket.remainingDay));
      if (!bucket.allowed) {
        res.setHeader("Retry-After", String(bucket.resetMinSec));
        res.status(429).json({
          error: "Rate limit exceeded",
          retryAfterSec: bucket.resetMinSec,
          minRemaining: bucket.remainingMin,
          dayRemaining: bucket.remainingDay,
        });
        return;
      }
      next();
    } catch (e) {
      // Fail-open on Redis outage rather than block all context traffic.
      console.warn("[veiledhood-context] rate-limit check failed, allowing request:", e);
      next();
    }
  };
}

/**
 * Best-effort current usage probe for the context quota indicator.
 * Reads counters without incrementing.
 */
export async function readContextUsage(
  env: Env,
  walletAddress: string,
): Promise<{ minRemaining: number; dayRemaining: number }> {
  if (env.CONTEXT_RATE_LIMIT_DISABLED) {
    return {
      minRemaining: env.CONTEXT_RATE_LIMIT_PER_USER_PER_MIN,
      dayRemaining: env.CONTEXT_RATE_LIMIT_PER_USER_PER_DAY,
    };
  }
  const redis = getRedis(env);
  const minKey = `context:rl:min:${walletAddress}`;
  const dayKey = `context:rl:day:${walletAddress}`;
  const [minRaw, dayRaw] = await redis.mget(minKey, dayKey);
  const minUsed = Number(minRaw ?? 0);
  const dayUsed = Number(dayRaw ?? 0);
  return {
    minRemaining: Math.max(0, env.CONTEXT_RATE_LIMIT_PER_USER_PER_MIN - minUsed),
    dayRemaining: Math.max(0, env.CONTEXT_RATE_LIMIT_PER_USER_PER_DAY - dayUsed),
  };
}
