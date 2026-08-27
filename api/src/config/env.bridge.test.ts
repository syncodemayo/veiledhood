import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
// Import the exported BRIDGE_ENV_SHAPE so we test the real schema, not a copy.
import { BRIDGE_ENV_SHAPE } from "./env.js";

test("bridge env shape parses a full valid config", () => {
  const schema = z.object(BRIDGE_ENV_SHAPE);
  const parsed = schema.parse({
    BRIDGE_ENABLED: "true",
    BRIDGE_ESCROW_SEED:
      "test test test test test test test test test test test junk",
    DEBRIDGE_API_URL: "https://dln.debridge.finance/v1.0",
    DEBRIDGE_REFERRAL_CODE: "0",
    BRIDGE_FEE_BPS: "25",
    BRIDGE_USER_DAILY_QUOTA: "5",
  });
  assert.equal(parsed.BRIDGE_ENABLED, true);
  assert.equal(parsed.BRIDGE_FEE_BPS, 25);
  assert.equal(parsed.BRIDGE_USER_DAILY_QUOTA, 5);
});

test("bridge env shape applies safe defaults when omitted", () => {
  const schema = z.object(BRIDGE_ENV_SHAPE);
  const parsed = schema.parse({});
  assert.equal(parsed.BRIDGE_ENABLED, false);
  assert.equal(parsed.BRIDGE_FEE_BPS, 0);
  assert.equal(parsed.DEBRIDGE_API_URL, "https://dln.debridge.finance/v1.0");
  assert.equal(parsed.DEBRIDGE_STATS_API_URL, "https://dln-api.debridge.finance/api");
  assert.equal(parsed.BRIDGE_ESCROW_SEED, undefined);
});

test("bridge fee bps is bounded to <= 10000", () => {
  const schema = z.object(BRIDGE_ENV_SHAPE);
  assert.throws(() => schema.parse({ BRIDGE_FEE_BPS: "10001" }), /BRIDGE_FEE_BPS/);
});
