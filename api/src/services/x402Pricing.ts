import type { Env } from "../config/env.js";

/**
 * Per-model x402 pricing for /ai/chat.
 *
 * `X402_AI_PRICE_MAP_JSON` is a JSON object mapping model id → raw USDC price
 * (1 USDC = 1_000_000). Models absent from the map fall back to the flat
 * `X402_PRICE_AI_CHAT_RAW_USDC`. A malformed or non-object value is treated as
 * an empty map (flat pricing) — pricing must never throw on the request path.
 *
 * Parsed maps are memoised per Env object so the JSON is parsed once, not on
 * every request.
 */

const cache = new WeakMap<Env, Map<string, bigint>>();

export function parseAiPriceMap(env: Env): Map<string, bigint> {
  const hit = cache.get(env);
  if (hit !== undefined) return hit;

  const map = new Map<string, bigint>();
  try {
    const raw = JSON.parse(env.X402_AI_PRICE_MAP_JSON) as unknown;
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
        // Accept integers or integer-strings; reject anything non-positive or
        // non-integral. Skip bad entries rather than failing the whole map.
        let price: bigint;
        try {
          if (typeof value === "number" && Number.isInteger(value)) {
            price = BigInt(value);
          } else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
            price = BigInt(value.trim());
          } else {
            continue;
          }
        } catch {
          continue;
        }
        if (price > 0n) map.set(model, price);
      }
    }
  } catch {
    // Malformed JSON → empty map (flat pricing).
  }

  cache.set(env, map);
  return map;
}

/**
 * Resolve the upfront x402 price for an /ai/chat request given the requested
 * model. Unknown/undefined model → the flat default.
 */
export function resolveX402AiPrice(env: Env, model?: string): bigint {
  if (model !== undefined) {
    const mapped = parseAiPriceMap(env).get(model);
    if (mapped !== undefined) return mapped;
  }
  return env.X402_PRICE_AI_CHAT_RAW_USDC;
}
