import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Env } from "../config/env.js";
import { createX402DiscoveryRouter } from "./x402Discovery.js";

const PATH = "/.well-known/x402-bazaar.json";

function makeEnv(x402Enabled: boolean): Env {
  return {
    X402_ENABLED: x402Enabled,
    // intentionally no SHROUDFI_MASTER_SEED / BASE_RPC_URL so isShroudFiReady
    // stays false even when the flag is on — verifies the safe-empty contract.
    X402_FACILITATOR_URL: "https://facilitator.payai.network",
    X402_PRICE_AI_CHAT_RAW_USDC: 10_000n,
    X402_PRICE_CONTEXT_FULL_RAW_USDC: 5_000n,
  } as unknown as Env;
}

let server: import("http").Server;

function listen(env: Env): Promise<string> {
  return new Promise((resolve) => {
    const app = express();
    app.use(createX402DiscoveryRouter(env));
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

after(() => {
  server?.close();
});

test("discovery endpoint returns a valid, disabled listing when x402 is off", async () => {
  const base = await listen(makeEnv(false));
  const res = await fetch(`${base}${PATH}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    name: string;
    enabled: boolean;
    endpoints: unknown[];
  };
  assert.equal(body.name, "Veiledhood");
  assert.equal(body.enabled, false);
  assert.deepEqual(body.endpoints, []);
});

test("discovery endpoint stays safe-empty when flag on but ShroudFi unconfigured", async () => {
  const base = await listen(makeEnv(true));
  const res = await fetch(`${base}${PATH}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { enabled: boolean; endpoints: unknown[] };
  // X402_ENABLED is true but no seed/RPC → isShroudFiReady false → still empty.
  assert.equal(body.enabled, false);
  assert.deepEqual(body.endpoints, []);
});
