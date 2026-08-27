import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { SolRouter } from "@solrouter/sdk";
import { socksDispatcher } from "fetch-socks";
import { fetch as undiciFetch } from "undici";
import type { Env } from "../config/env.js";

/**
 * SolRouter is the privacy-preserving inference provider (Arcium + AWS Nitro TEE).
 * Outbound traffic from this process is optionally routed through a local Tor
 * SOCKS5 proxy so SolRouter never observes the API server's IP.
 *
 * Per-user Tor stream isolation: each Veiledhood user gets a distinct Tor circuit
 * by passing a user-specific SOCKS5 username/password. Tor reads SOCKS auth
 * credentials as a stream isolation key (see `IsolateSOCKSAuth` in tor.1).
 */

const DEFAULT_BASE_URL = "https://solrouter-obb4.onrender.com";

// Pin the resolved base URL once so the global fetch patch can scope precisely.
let resolvedBaseUrl: string | null = null;
let installedTorFetch = false;

function getBaseUrl(env: Env): string {
  const explicit = env.SOLROUTER_BASE_URL?.trim();
  return explicit && explicit.length > 0 ? explicit : DEFAULT_BASE_URL;
}

function userIsolationId(userId: string): string {
  // Truncated SHA-256 of the wallet address — opaque to SolRouter, stable per-user.
  return crypto.createHash("sha256").update(userId).digest("hex").slice(0, 24);
}

/**
 * Install a global `fetch` shim that:
 *   - For SolRouter URLs: routes through a per-user SOCKS5 dispatcher when
 *     a `veiledhood-user` request header is present, else uses a default
 *     (non-isolated) Tor dispatcher.
 *   - For non-SolRouter URLs: passes through to undici fetch unchanged.
 *
 * Idempotent: subsequent calls are no-ops.
 *
 * Node 24 ships undici@7; fetch-socks 1.3.3 returns an undici@8 dispatcher
 * which uses interceptors v7 rejects. To work around this we ALWAYS route
 * through `undici@^8`'s fetch (the dependency we pinned) rather than
 * Node's built-in. See docs/phase-1/GATE-A-empirical-tor-probe.md.
 */
function installTorFetchOnce(env: Env): void {
  if (installedTorFetch) return;
  resolvedBaseUrl = getBaseUrl(env).replace(/\/+$/, "");
  const torHost = env.TOR_SOCKS_HOST;
  const torPort = env.TOR_SOCKS_PORT;
  const torEnabled = env.TOR_ENABLED;

  const dispatcherCache = new Map<string, ReturnType<typeof socksDispatcher>>();
  function getDispatcher(isolationKey: string): ReturnType<typeof socksDispatcher> {
    const cached = dispatcherCache.get(isolationKey);
    if (cached) return cached;
    const d = socksDispatcher({
      type: 5,
      host: torHost,
      port: torPort,
      userId: isolationKey,
      password: "veiledhood",
    });
    dispatcherCache.set(isolationKey, d);
    return d;
  }

  // Default dispatcher (no per-user isolation) for the rare call without context.
  const defaultDispatcher = torEnabled
    ? socksDispatcher({ type: 5, host: torHost, port: torPort })
    : null;

  // Used to thread isolation through async-local context. The SDK doesn't
  // pass custom headers we can sniff, so we set a Node async-local instead.
  // For simplicity we read it from globalThis on the active async tick.
  globalThis.fetch = ((input: unknown, init?: unknown) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as { url?: string }).url ?? "";
    const goesToSolRouter = resolvedBaseUrl !== null && url.startsWith(resolvedBaseUrl);
    // Cast to undici's request signature — Node global Request type doesn't
    // line up perfectly with undici's Request (it expects `duplex`), but at
    // runtime undici accepts string/URL/Request transparently.
    type UndiciInput = Parameters<typeof undiciFetch>[0];
    type UndiciInit = Parameters<typeof undiciFetch>[1];
    if (!torEnabled || !goesToSolRouter) {
      return undiciFetch(input as UndiciInput, init as UndiciInit);
    }
    const isolation = veiledhoodIsolationContext.getStore();
    const dispatcher = isolation
      ? getDispatcher(isolation)
      : defaultDispatcher!;
    return undiciFetch(input as UndiciInput, {
      ...((init as UndiciInit) || {}),
      dispatcher,
    });
  }) as unknown as typeof fetch;

  installedTorFetch = true;
}

/**
 * `AsyncLocalStorage`-backed thread-local that scopes a SolRouter call to a
 * specific user's Tor circuit. The route handler wraps each `chat()` /
 * `getBalance()` call in `withVeiledhoodUser(addr, fn)` so the patched
 * global fetch can pick up the right dispatcher.
 */
const veiledhoodIsolationContext = new AsyncLocalStorage<string>();

export async function withVeiledhoodUserCircuit<T>(walletAddress: string, fn: () => Promise<T>): Promise<T> {
  const key = userIsolationId(walletAddress);
  return veiledhoodIsolationContext.run(key, fn);
}

let cachedClient: SolRouter | null = null;

export function getSolRouterClient(env: Env): SolRouter {
  if (cachedClient) return cachedClient;
  if (!env.SOLROUTER_API_KEY) {
    throw new Error("SOLROUTER_API_KEY is not configured");
  }
  installTorFetchOnce(env);
  cachedClient = new SolRouter({
    apiKey: env.SOLROUTER_API_KEY,
    baseUrl: resolvedBaseUrl ?? undefined,
  });
  return cachedClient;
}

/** Caller-facing error from a SolRouter call. Maps to a sensible HTTP status. */
export class SolRouterCallError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | "auth"
      | "rate_limit"
      | "model_unavailable"
      | "network"
      | "server"
      | "unknown",
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SolRouterCallError";
  }
}

function classifyError(err: unknown): SolRouterCallError {
  const msg = err instanceof Error ? err.message : String(err);
  const causeMsg =
    err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  const combined = `${msg} ${causeMsg}`.toLowerCase();
  if (combined.includes("401") || combined.includes("unauthorized")) {
    return new SolRouterCallError(msg, "auth", false);
  }
  if (combined.includes("429") || combined.includes("rate limit")) {
    return new SolRouterCallError(msg, "rate_limit", true);
  }
  if (combined.includes("model") && combined.includes("not")) {
    return new SolRouterCallError(msg, "model_unavailable", false);
  }
  if (
    combined.includes("fetch failed") ||
    combined.includes("econnreset") ||
    combined.includes("socket") ||
    combined.includes("timeout") ||
    combined.includes("tor")
  ) {
    return new SolRouterCallError(msg, "network", true);
  }
  if (combined.includes("500") || combined.includes("502") || combined.includes("503")) {
    return new SolRouterCallError(msg, "server", true);
  }
  return new SolRouterCallError(msg, "unknown", true);
}

export interface ChatPrivatelyParams {
  prompt: string;
  model: string;
  walletAddress: string;
  systemPrompt?: string;
  maxTokens?: number;
}

export interface ChatPrivatelyResult {
  message: string;
  modelUsed: string;
  costUsdc: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

/**
 * Call SolRouter inside the per-user Tor circuit, with retry on transient
 * network errors (new isolation key forces Tor to build a fresh circuit).
 */
export async function chatPrivately(
  env: Env,
  params: ChatPrivatelyParams,
): Promise<ChatPrivatelyResult> {
  const client = getSolRouterClient(env);
  const baseAttempts = 3;
  let lastError: SolRouterCallError | null = null;

  for (let attempt = 1; attempt <= baseAttempts; attempt++) {
    // First attempt uses deterministic per-user isolation (k-anonymity benefit
    // across sequential calls). Retries mix in a timestamp so we get a truly
    // fresh circuit — without this, a user that lands on flaky exits gets
    // stuck reusing them until Tor's internal circuit timeout (~10 min).
    const isolationSuffix =
      attempt > 1 ? `:retry${attempt}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}` : "";
    try {
      return await withVeiledhoodUserCircuit(params.walletAddress + isolationSuffix, async () => {
        // SDK types restrict `model` to a literal union — we validate the
        // string against the env whitelist at the route boundary and cast
        // here so adding a new SolRouter model doesn't require an SDK upgrade.
        const resp = await client.chat(params.prompt, {
          model: params.model as never,
          systemPrompt: params.systemPrompt,
        });
        const message =
          typeof resp?.message === "string"
            ? resp.message
            : JSON.stringify(resp);
        return {
          message,
          modelUsed: resp?.model ?? params.model,
          costUsdc:
            typeof resp?.cost === "number" ? resp.cost.toString() : null,
          tokensIn:
            typeof resp?.usage?.promptTokens === "number"
              ? resp.usage.promptTokens
              : null,
          tokensOut:
            typeof resp?.usage?.completionTokens === "number"
              ? resp.usage.completionTokens
              : null,
        };
      });
    } catch (e) {
      const classified = classifyError(e);
      lastError = classified;
      if (!classified.retryable || attempt === baseAttempts) break;
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
  throw lastError ?? new SolRouterCallError("unknown failure", "unknown", false);
}

export async function getSolRouterBalance(env: Env): Promise<{
  raw: string;
  formatted: string;
}> {
  const client = getSolRouterClient(env);
  return withVeiledhoodUserCircuit("veiledhood:treasury", async () => {
    const bal = await client.getBalance();
    const raw = typeof bal.balance === "number" ? bal.balance.toString() : "0";
    return { raw, formatted: bal.balanceFormatted ?? raw };
  });
}
