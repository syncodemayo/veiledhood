import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getUSDC } from "@shroud-fi/transport";
import {
  createX402Server,
  X402_PAYMENT_REQUIRED_HEADER,
  X402_PAYMENT_SIGNATURE_HEADER,
  X402_PAYMENT_RESPONSE_HEADER,
  type X402Challenge,
  type X402PaymentRequirements,
  type X402PaymentPayload,
} from "@shroud-fi/x402";
import type { Env } from "../config/env.js";
import { getShroudFiContext, isShroudFiReady } from "../services/shroudAgent.js";
import { getRedis } from "./rateLimit.js";

/**
 * Stealth-x402 middleware.
 *
 * Per request:
 *   1. No X-PAYMENT header → mint a fresh stealth challenge via
 *      `@shroud-fi/x402`, cache `{ priceAtomic, ephemeralPubKey, viewTag }`
 *      in Redis keyed by the stealth address. Return 402 with the challenge
 *      body in body + header.
 *   2. X-PAYMENT present → decode it, extract `auth.to` (the stealth address
 *      the client signed for), look up the cached challenge, reconstruct an
 *      X402Challenge object, call `x402.verify(...)`. On `valid: true`,
 *      attach `req.x402` and call `next()`. Post-settle: set
 *      `X-PAYMENT-RESPONSE` header with the facilitator's settle tx hash.
 *
 * Why stateful: ShroudFi's `verify()` cross-checks the signed `auth.to`
 * against the issued challenge's `payTo`. Without state we'd have to trust
 * any stealth address the client claims is "ours" — that lets a malicious
 * client redirect payments. Caching the issued challenge for 5 minutes
 * (DEFAULT_MAX_TIMEOUT_SECS in ShroudFi's protocol) is the spec-safe path.
 *
 * Privacy invariants:
 *   - Never log full signatures, nonces, or amount values. Only metadata
 *     (resource, stealthAddress prefix, txHash, elapsed).
 *   - Reject quickly on any structural failure to avoid timing oracles.
 */

const CHALLENGE_TTL_SEC = 300; // matches @shroud-fi/x402 DEFAULT_MAX_TIMEOUT_SECS
const REDIS_KEY_PREFIX = "x402:challenge:";

interface CachedChallenge {
  priceAtomic: string;
  resource: string;
  ephemeralPubKey: string;
  viewTag: number;
  issuedAt: number;
  /**
   * Request-derived fields captured at challenge time (e.g. the priced model).
   * On the paid retry the same fields are recomputed and must match — this
   * stops a client from challenging a cheap model then retrying an expensive
   * one against the same (cheap) payment.
   */
  bind?: Record<string, string>;
}

declare module "express-serve-static-core" {
  interface Request {
    x402?: {
      stealthAddress: string;
      payerAddress: string;
      paidAtomic: bigint;
      settledTxHash?: string;
      resource: string;
    };
  }
}

export interface X402GateOptions {
  /**
   * Logical resource identifier used in the 402 challenge body. Must be a
   * stable URL or pseudo-URL for the protected route.
   */
  resource: string;
  /**
   * Price in raw USDC units (1 USDC = 1_000_000 raw). Server-enforced. May be
   * a function resolved per request (e.g. per-model pricing) — the resolved
   * value is cached against the issued challenge, so the paid retry is always
   * verified against the originally-challenged price.
   */
  priceAtomic: bigint | ((req: Request) => bigint);
  /**
   * Optional human-readable description shown in the 402 body.
   */
  description?: string;
  /**
   * Optional request-derived fields to bind the payment to. Captured at
   * challenge time and re-checked for equality on the paid retry; a mismatch
   * is rejected with 402. Use for any field that influences the price (e.g.
   * `{ model }` for /ai/chat).
   */
  bind?: (req: Request) => Record<string, string>;
}

function resolvePrice(opts: X402GateOptions, req: Request): bigint {
  return typeof opts.priceAtomic === "function" ? opts.priceAtomic(req) : opts.priceAtomic;
}

export function x402Gate(env: Env, opts: X402GateOptions): RequestHandler {
  if (!isShroudFiReady(env)) {
    // Return a middleware that 503s — keeps boot non-blocking for envs that
    // haven't enabled x402 yet (e.g. local dev without keys).
    return (_req: Request, res: Response, _next: NextFunction): void => {
      res.status(503).json({ error: "x402 not configured on this server" });
    };
  }

  const ctx = getShroudFiContext(env);
  const chainId = ctx.transport.chain.id;
  const usdc = getUSDC(chainId);
  if (usdc === undefined) {
    return (_req: Request, res: Response, _next: NextFunction): void => {
      res.status(503).json({ error: `USDC address unknown for chain ${chainId}` });
    };
  }

  const server = createX402Server({
    transport: ctx.transport,
    recipientMetaAddress: ctx.recipientMetaAddress,
    asset: usdc,
    chainId,
    // Concrete fallback for the SDK constructor; the per-call price is always
    // passed explicitly to server.challenge(), so this is never the effective
    // price when priceAtomic is a resolver function.
    defaultPriceAtomic: typeof opts.priceAtomic === "function" ? 1n : opts.priceAtomic,
    facilitator: { url: env.X402_FACILITATOR_URL },
  });

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startedAt = Date.now();
    const header = req.headers[X402_PAYMENT_SIGNATURE_HEADER.toLowerCase()];
    const headerValue = Array.isArray(header) ? header[0] : header;

    if (headerValue === undefined || headerValue === "") {
      await issueChallenge(env, server, opts, req, res, startedAt);
      return;
    }

    await handleSignedPayment(env, server, opts, req, res, next, headerValue, startedAt);
  };
}

async function issueChallenge(
  env: Env,
  server: ReturnType<typeof createX402Server>,
  opts: X402GateOptions,
  req: Request,
  res: Response,
  startedAt: number,
): Promise<void> {
  const priceAtomic = resolvePrice(opts, req);
  const bind = opts.bind ? opts.bind(req) : undefined;
  let challenge: X402Challenge;
  try {
    challenge = await server.challenge({
      resource: opts.resource,
      ...(opts.description !== undefined ? { description: opts.description } : {}),
      priceAtomic,
    });
  } catch (e) {
    console.error(
      `[veiledhood-x402] challenge mint failed resource=${opts.resource} err=${e instanceof Error ? e.message : String(e)}`,
    );
    res.status(503).json({ error: "Could not mint x402 challenge" });
    return;
  }

  const stealthAddress = challenge.announcement.stealthAddress.toLowerCase();
  const cached: CachedChallenge = {
    priceAtomic: priceAtomic.toString(),
    resource: opts.resource,
    ephemeralPubKey: challenge.announcement.ephemeralPubKey,
    viewTag: challenge.announcement.viewTag,
    issuedAt: startedAt,
    ...(bind !== undefined ? { bind } : {}),
  };

  try {
    const redis = getRedis(env);
    await redis.set(
      REDIS_KEY_PREFIX + stealthAddress,
      JSON.stringify(cached),
      "EX",
      CHALLENGE_TTL_SEC,
    );
  } catch (e) {
    // Redis is critical for safe verify — fail-closed.
    console.error(
      `[veiledhood-x402] could not cache challenge stealth=${stealthAddress.slice(0, 10)}… err=${e instanceof Error ? e.message : String(e)}`,
    );
    res.status(503).json({ error: "x402 state unavailable" });
    return;
  }

  res
    .status(402)
    .set(X402_PAYMENT_REQUIRED_HEADER, challenge.headers[X402_PAYMENT_REQUIRED_HEADER] ?? "")
    .json(challenge.body);

  console.log(
    `[veiledhood-x402] 402 issued resource=${opts.resource} stealth=${stealthAddress.slice(0, 10)}… price=${priceAtomic.toString()} elapsed=${Date.now() - startedAt}ms`,
  );
}

async function handleSignedPayment(
  env: Env,
  server: ReturnType<typeof createX402Server>,
  opts: X402GateOptions,
  req: Request,
  res: Response,
  next: NextFunction,
  headerValue: string,
  startedAt: number,
): Promise<void> {
  // Decode payment payload to extract the stealth address (auth.to).
  let payload: X402PaymentPayload;
  try {
    const json = Buffer.from(headerValue, "base64").toString("utf-8");
    payload = JSON.parse(json) as X402PaymentPayload;
  } catch {
    res.status(400).json({ error: "Malformed X-PAYMENT header" });
    return;
  }

  const authTo = payload?.payload?.authorization?.to;
  const authFrom = payload?.payload?.authorization?.from;
  const authValue = payload?.payload?.authorization?.value;
  if (
    typeof authTo !== "string" ||
    typeof authFrom !== "string" ||
    typeof authValue !== "string"
  ) {
    res.status(400).json({ error: "Malformed X-PAYMENT authorization" });
    return;
  }

  const stealthAddress = authTo.toLowerCase();

  // Pull the cached challenge by stealth address.
  let cached: CachedChallenge | null = null;
  try {
    const raw = await getRedis(env).get(REDIS_KEY_PREFIX + stealthAddress);
    if (raw !== null) {
      cached = JSON.parse(raw) as CachedChallenge;
    }
  } catch (e) {
    console.error(
      `[veiledhood-x402] redis lookup failed stealth=${stealthAddress.slice(0, 10)}… err=${e instanceof Error ? e.message : String(e)}`,
    );
    res.status(503).json({ error: "x402 state unavailable" });
    return;
  }

  if (cached === null) {
    // No challenge issued for this stealth address (expired, never issued,
    // or another instance). Mint a fresh challenge — client retries.
    await issueChallenge(env, server, opts, req, res, startedAt);
    return;
  }

  // Resource check — the cached challenge must match this route.
  if (cached.resource !== opts.resource) {
    res.status(402).json({ error: "Payment intended for a different resource" });
    return;
  }

  // Binding check — request-derived fields that influenced the price (e.g. the
  // model) must match what was challenged. Prevents challenge-cheap /
  // retry-expensive abuse. Re-mint so the client pays the correct price.
  if (opts.bind !== undefined) {
    const want = cached.bind ?? {};
    const got = opts.bind(req);
    const keys = new Set([...Object.keys(want), ...Object.keys(got)]);
    for (const k of keys) {
      if (want[k] !== got[k]) {
        console.warn(
          `[veiledhood-x402] binding mismatch resource=${opts.resource} key=${k} stealth=${stealthAddress.slice(0, 10)}… — re-issuing`,
        );
        await issueChallenge(env, server, opts, req, res, startedAt);
        return;
      }
    }
  }

  // Reconstruct the X402Challenge object so verify() can cross-check it.
  const requirements: X402PaymentRequirements = {
    scheme: "exact",
    network: `eip155:${getShroudFiContext(env).transport.chain.id}`,
    maxAmountRequired: cached.priceAtomic,
    asset: getUSDC(getShroudFiContext(env).transport.chain.id)!,
    payTo: authTo as `0x${string}`,
    maxTimeoutSeconds: CHALLENGE_TTL_SEC,
    resource: cached.resource,
    extra: {
      name: "USD Coin",
      version: "2",
      shroudfiAnnouncement: {
        ephemeralPubKey: cached.ephemeralPubKey as `0x${string}`,
        viewTag: cached.viewTag,
      },
    },
  };

  const reconstructed: X402Challenge = {
    status: 402,
    headers: {},
    body: {
      x402Version: 2,
      error: "Payment required",
      accepts: [requirements] as const,
    },
    announcement: {
      ephemeralPubKey: cached.ephemeralPubKey as `0x${string}`,
      viewTag: cached.viewTag,
      stealthAddress: authTo as `0x${string}`,
    },
  };

  // Verify via the configured facilitator (PayAI by default — see env config).
  let verification;
  try {
    verification = await server.verify({
      signedPayload: payload,
      challenge: reconstructed,
    });
  } catch (e) {
    console.error(
      `[veiledhood-x402] verify threw stealth=${stealthAddress.slice(0, 10)}… err=${e instanceof Error ? e.message : String(e)}`,
    );
    res.status(502).json({ error: "x402 facilitator error" });
    return;
  }

  if (!verification.valid) {
    const tag = verification.error ?? "unknown";
    console.warn(
      `[veiledhood-x402] verify rejected stealth=${stealthAddress.slice(0, 10)}… reason=${tag} elapsed=${Date.now() - startedAt}ms`,
    );
    if (tag === "expired" || tag === "facilitator_unreachable") {
      res.status(502).json({ error: `x402 ${tag}` });
    } else {
      // Invalid sig / mismatched amount → 402 with reason tag.
      res.status(402).json({ error: `x402 ${tag}` });
    }
    return;
  }

  // Burn the challenge so the same signed payload can't be replayed.
  try {
    await getRedis(env).del(REDIS_KEY_PREFIX + stealthAddress);
  } catch {
    // Non-fatal — TTL will reap.
  }

  // Pin payment metadata onto the request for downstream handlers / logging.
  req.x402 = {
    stealthAddress: authTo,
    payerAddress: authFrom,
    paidAtomic: BigInt(authValue),
    resource: opts.resource,
    ...(verification.settledTxHash !== undefined
      ? { settledTxHash: verification.settledTxHash }
      : {}),
  };

  // Set X-PAYMENT-RESPONSE so x402 clients can surface the settle tx hash.
  if (verification.settledTxHash !== undefined) {
    const settlement = {
      txHash: verification.settledTxHash,
      network: `eip155:${getShroudFiContext(env).transport.chain.id}`,
      settledAt: Math.floor(Date.now() / 1000),
    };
    res.set(
      X402_PAYMENT_RESPONSE_HEADER,
      Buffer.from(JSON.stringify(settlement), "utf-8").toString("base64"),
    );
  }

  console.log(
    `[veiledhood-x402] paid resource=${opts.resource} stealth=${stealthAddress.slice(0, 10)}… payer=${authFrom.slice(0, 10)}… tx=${verification.settledTxHash?.slice(0, 12) ?? "(self-settle)"}… elapsed=${Date.now() - startedAt}ms`,
  );

  next();
}
