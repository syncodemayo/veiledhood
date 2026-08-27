import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeChargeRawUsdc,
  formatUsdcRaw,
  MIN_CHARGE_RAW_USDC,
} from "./aiBilling.js";

test("computeChargeRawUsdc prefers SolRouter cost when present", () => {
  const raw = computeChargeRawUsdc({
    model: "gpt-oss-20b",
    costUsdc: "0.001234",
    tokensIn: 50,
    tokensOut: 100,
  });
  // 0.001234 * 1e6 = 1234 raw USDC
  assert.equal(raw, 1234n);
});

test("computeChargeRawUsdc falls back to token estimate when cost absent", () => {
  const raw = computeChargeRawUsdc({
    model: "gpt-oss-20b",
    costUsdc: null,
    tokensIn: 500,
    tokensOut: 500,
  });
  // 1000 tokens * 100 / 1000 = 100 raw → floored to MIN_CHARGE_RAW_USDC (1000)
  assert.equal(raw, MIN_CHARGE_RAW_USDC);
});

test("computeChargeRawUsdc floors at MIN_CHARGE_RAW_USDC for tiny calls", () => {
  const raw = computeChargeRawUsdc({
    model: "gpt-oss-20b",
    costUsdc: "0.0000001",
    tokensIn: 1,
    tokensOut: 1,
  });
  assert.equal(raw, MIN_CHARGE_RAW_USDC);
});

test("computeChargeRawUsdc handles fuzzy model names from upstream provider", () => {
  // SolRouter routes through Nosana and returns model id "nosana:gpt-oss:20b".
  const raw = computeChargeRawUsdc({
    model: "nosana:gpt-oss:20b",
    costUsdc: null,
    tokensIn: 10_000,
    tokensOut: 10_000,
  });
  // Should match gpt-oss-20b's price (100 raw/1k), 20k tokens → 2000 raw.
  assert.equal(raw, 2000n);
});

test("formatUsdcRaw renders 6-decimal raw to short decimal", () => {
  assert.equal(formatUsdcRaw(1234n, 4), "0.0012");
  assert.equal(formatUsdcRaw(1234n), "0.001234");
  assert.equal(formatUsdcRaw(1_000_000n), "1");
  assert.equal(formatUsdcRaw(0n), "0");
});
