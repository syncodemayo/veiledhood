import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_CURRENCY_KEY } from "../constants/currency.js";
import type { Env } from "../config/env.js";
import { getTransferFeeConfigForCurrency } from "./transferFeeConfig.js";

function mockEnv(partial: Partial<Env>): Env {
  return {
    MONGODB_URI: "mongodb://localhost",
    JWT_SECRET: "x".repeat(32),
    JWT_EXPIRES_IN: "7d",
    PORT: 3000,
    MERKLE_INDEXER_FROM_BLOCK: 0,
    INDEXER_POLL_MS: 15_000,
    WITHDRAW_DEADLINE_MAX_SEC: 900,
    transferFeeConfig: {
      [NATIVE_CURRENCY_KEY]: { fixed: "1000", bps: 30 },
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": { fixed: "100", bps: 50 },
    },
    TRANSFER_FEE_LEDGER_ADDRESS: "0x1111111111111111111111111111111111111111",
    ...partial,
  } as Env;
}

test("native uses fee map entry", () => {
  const env = mockEnv({});
  const c = getTransferFeeConfigForCurrency(env, NATIVE_CURRENCY_KEY);
  assert.equal(c.fixed, 1000n);
  assert.equal(c.bps, 30);
});

test("token address uses fee map entry", () => {
  const env = mockEnv({});
  const c = getTransferFeeConfigForCurrency(
    env,
    "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa"
  );
  assert.equal(c.fixed, 100n);
  assert.equal(c.bps, 50);
});

test("unknown token has zero fees", () => {
  const env = mockEnv({});
  const c = getTransferFeeConfigForCurrency(
    env,
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  );
  assert.equal(c.fixed, 0n);
  assert.equal(c.bps, 0);
});
