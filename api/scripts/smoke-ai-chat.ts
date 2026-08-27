/**
 * E2E smoke for the SolRouter + Tor + rate-limit path WITHOUT spinning up
 * Mongo or Express. Exercises the same code the `/ai/chat` route uses.
 *
 * Pre-reqs (run before this script):
 *   - Tor daemon on 127.0.0.1:9050 (see GATE-A-empirical-tor-probe.md)
 *   - Redis on 127.0.0.1:6379
 *   - SOLROUTER_API_KEY in env
 *
 * Usage:
 *   SOLROUTER_API_KEY=sk_solrouter_xxx tsx api/scripts/smoke-ai-chat.ts
 */
import { chatPrivately, SolRouterCallError } from "../src/services/solRouterClient.js";
import type { Env } from "../src/config/env.js";

const env = {
  SOLROUTER_API_KEY: process.env.SOLROUTER_API_KEY,
  SOLROUTER_BASE_URL: process.env.SOLROUTER_BASE_URL,
  AI_MODEL_WHITELIST: "gpt-oss-20b,qwen3-8b,llama-3.1-8b",
  TOR_SOCKS_HOST: process.env.TOR_SOCKS_HOST ?? "127.0.0.1",
  TOR_SOCKS_PORT: Number(process.env.TOR_SOCKS_PORT ?? "9050"),
  TOR_ENABLED: (process.env.TOR_ENABLED ?? "true").toLowerCase() === "true",
  AI_RATE_LIMIT_PER_USER_PER_DAY: 50,
  AI_RATE_LIMIT_PER_USER_PER_MIN: 5,
  REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  AI_RATE_LIMIT_DISABLED: false,
} as unknown as Env;

if (!env.SOLROUTER_API_KEY) {
  console.error("Set SOLROUTER_API_KEY");
  process.exit(1);
}

const wallets = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
];

(async () => {
  for (const w of wallets) {
    process.stdout.write(`\n[smoke] user=${w.slice(0, 10)}… `);
    const started = Date.now();
    try {
      const r = await chatPrivately(env, {
        prompt: "Reply with just the word: pong",
        model: "gpt-oss-20b",
        walletAddress: w,
        maxTokens: 8,
      });
      const dt = Date.now() - started;
      process.stdout.write(
        `OK msg="${r.message.slice(0, 40)}" cost=${r.costUsdc ?? "?"} tokensOut=${r.tokensOut ?? "?"} dt=${dt}ms`,
      );
    } catch (e) {
      if (e instanceof SolRouterCallError) {
        process.stdout.write(`FAIL kind=${e.kind} msg=${e.message.slice(0, 120)}`);
      } else {
        process.stdout.write(
          `FAIL ${e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)}`,
        );
      }
    }
  }
  process.stdout.write("\n[smoke] done\n");
  process.exit(0);
})();
