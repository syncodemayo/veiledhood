import express, { type Application } from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { Env } from "../config/env.js";

/**
 * Shared test bootstrap helpers for `agents.test.ts` (and future route tests).
 *
 * Design rules:
 * - Caller must set required env vars BEFORE importing `env.ts` (which
 *   eagerly reads `process.env`). Use `setEnvForTest` at the very top of the
 *   test file (before any other Veiledhood imports).
 * - `buildApp` mounts only what the agents tests need (json body parser,
 *   health, agents router). Other routers (which boot RPC providers, redis,
 *   etc.) are skipped.
 * - `clearAllAgentData` drops the `agents` + `agentenvelopes` collections so
 *   each test starts from a known state.
 */

export interface TestMongo {
  uri: string;
  stop: () => Promise<void>;
}

let memServer: MongoMemoryServer | null = null;

export async function startTestMongo(): Promise<TestMongo> {
  memServer = await MongoMemoryServer.create();
  const uri = memServer.getUri();
  return {
    uri,
    stop: async () => {
      if (memServer) {
        await memServer.stop();
        memServer = null;
      }
    },
  };
}

/**
 * Sets every env var required by `loadEnv()`'s schema. MUST be called BEFORE
 * any `import` that transitively pulls in `../config/env.js`.
 */
export function setEnvForTest(uri: string): void {
  process.env.MONGODB_URI = uri;
  process.env.JWT_SECRET = "test-secret-do-not-use-in-prod-0000";
  process.env.JWT_EXPIRES_IN = "1h";
  // PORT must be positive integer per env schema. App.listen() is never
  // called in tests (supertest binds to an ephemeral port itself), so the
  // value is unused — pick any valid one.
  process.env.PORT = "3000";
  process.env.AGENTS_RATE_LIMIT_DISABLED = "true";
  process.env.AGENTS_MAX_PER_USER = "20";
  process.env.AGENTS_MAX_CIPHERTEXT_BYTES = "16384";
  process.env.AGENTS_RATE_LIMIT_PER_USER_PER_MIN = "30";
  process.env.AGENTS_RATE_LIMIT_PER_USER_PER_DAY = "500";
  process.env.AI_RATE_LIMIT_DISABLED = "true";
  process.env.INDEXER_DISABLED = "true";
  // Wallet-context (Phase 3) — disable rate limit + use tiny batching window
  // so tests don't sleep on the default 100ms timer.
  process.env.CONTEXT_RATE_LIMIT_DISABLED = "true";
  process.env.RPC_POOL_BATCH_WINDOW_MS = "10";
  process.env.RPC_POOL_JITTER_MAX_MS = "0";
  process.env.RPC_POOL_DECOY_RATIO = "0";
  process.env.RPC_POOL_FAILOVER_ERROR_THRESHOLD = "3";
  process.env.RPC_POOL_FAILOVER_WINDOW_S = "30";
  process.env.PRICE_CACHE_TTL_S = "0"; // never cache during tests
  // No CORS_ORIGIN, no RPC_URL, no contract addresses — agents router doesn't
  // need them and skipping keeps the schema happy.
}

/**
 * Mints a real JWT signed with `jwtSecret`. `sub` is the wallet address that
 * `requireAuth` will trust and stamp onto `req.walletAddress`.
 */
export function makeJwt(
  walletAddress: string,
  jwtSecret: string,
  expiresIn: string | number = "1h",
): string {
  return jwt.sign({ sub: walletAddress.toLowerCase() }, jwtSecret, {
    expiresIn: expiresIn as jwt.SignOptions["expiresIn"],
  });
}

/**
 * Drops the agents + agent_envelopes collections between tests. Cheaper than
 * stop/start of the memory server, fast enough for the full suite.
 */
export async function clearAllAgentData(): Promise<void> {
  const conn = mongoose.connection;
  if (conn.readyState !== 1) return;
  const collections = await conn.db!.collections();
  for (const c of collections) {
    if (c.collectionName === "agents" || c.collectionName === "agentenvelopes") {
      await c.deleteMany({});
    }
  }
}

/**
 * Builds an Express app with just the routes needed for agents tests. Skips
 * the boot-time mongoose connect (caller already connected), CORS, and all
 * other routers (RPC providers, swap, transfer, etc. — none of which the
 * agents tests exercise).
 */
export async function buildApp(env: Env): Promise<Application> {
  const { default: healthRouter } = await import("../routes/health.js");
  const { createAgentsRouter } = await import("../routes/agents.js");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(healthRouter);
  app.use(createAgentsRouter(env));
  return app;
}

/**
 * Builds an Express app that mounts the /context/* router with caller-supplied
 * service deps (typically mocked pooledRpcProxy + priceOracle). Mongoose must
 * already be connected.
 */
export async function buildContextApp(
  env: Env,
  deps: import("../routes/context.js").CreateContextRouterDeps,
): Promise<Application> {
  const { default: healthRouter } = await import("../routes/health.js");
  const { createContextRouter } = await import("../routes/context.js");
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(healthRouter);
  app.use(createContextRouter(env, deps));
  return app;
}

/**
 * Drops the user_balances collection between context tests.
 */
export async function clearAllUserBalances(): Promise<void> {
  const conn = mongoose.connection;
  if (conn.readyState !== 1) return;
  const collections = await conn.db!.collections();
  for (const c of collections) {
    if (c.collectionName === "userbalances" || c.collectionName === "user_balances") {
      await c.deleteMany({});
    }
  }
}

/**
 * Returns a fresh, valid 20-byte hex Ethereum-style address. Used per-test
 * to enforce cross-user isolation.
 */
export function randAddr(): string {
  const bytes = new Uint8Array(20);
  // Node 22 has webcrypto on globalThis.crypto
  globalThis.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return "0x" + hex;
}
