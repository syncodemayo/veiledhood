import { Router } from "express";
import net from "node:net";
import type { Env } from "../config/env.js";
import { getRedis } from "../middleware/rateLimit.js";

/**
 * `/health/ai` — green only if every leg of the AI request path is reachable:
 *   - Redis (rate-limit store)
 *   - Tor SOCKS5 port (if TOR_ENABLED)
 *   - SolRouter API key configured
 *
 * Lightweight checks only. Does NOT make a paid SolRouter call.
 */

async function checkTcpPort(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        /* noop */
      }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

export function createAiHealthRouter(env: Env): Router {
  const router = Router();
  router.get("/health/ai", async (_req, res) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    // Redis ping
    try {
      const redis = getRedis(env);
      const pong = await redis.ping();
      checks.redis = { ok: pong === "PONG", detail: pong };
    } catch (e) {
      checks.redis = {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      };
    }

    // Tor SOCKS5 port (only if enabled)
    if (env.TOR_ENABLED) {
      const torOk = await checkTcpPort(env.TOR_SOCKS_HOST, env.TOR_SOCKS_PORT);
      checks.tor = {
        ok: torOk,
        detail: `${env.TOR_SOCKS_HOST}:${env.TOR_SOCKS_PORT}`,
      };
    } else {
      checks.tor = { ok: true, detail: "disabled" };
    }

    // SolRouter API key presence
    checks.solrouter = {
      ok: Boolean(env.SOLROUTER_API_KEY),
      detail: env.SOLROUTER_API_KEY ? "configured" : "missing",
    };

    const ok = Object.values(checks).every((c) => c.ok);
    res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", checks });
  });
  return router;
}
