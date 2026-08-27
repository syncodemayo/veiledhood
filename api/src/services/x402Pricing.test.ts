import { test } from "node:test";
import assert from "node:assert/strict";
import type { Env } from "../config/env.js";
import { resolveX402AiPrice, parseAiPriceMap } from "./x402Pricing.js";

function makeEnv(mapJson: string, flat = 10_000n): Env {
  return {
    X402_AI_PRICE_MAP_JSON: mapJson,
    X402_PRICE_AI_CHAT_RAW_USDC: flat,
  } as unknown as Env;
}

test("returns mapped price for a listed model (number value)", () => {
  const env = makeEnv('{"claude-opus-4-8":80000,"gpt-oss-20b":2000}');
  assert.equal(resolveX402AiPrice(env, "claude-opus-4-8"), 80_000n);
  assert.equal(resolveX402AiPrice(env, "gpt-oss-20b"), 2_000n);
});

test("accepts integer-string values", () => {
  const env = makeEnv('{"big-model":"123456"}');
  assert.equal(resolveX402AiPrice(env, "big-model"), 123_456n);
});

test("falls back to flat default for unlisted or undefined model", () => {
  const env = makeEnv('{"claude-opus-4-8":80000}', 10_000n);
  assert.equal(resolveX402AiPrice(env, "some-other-model"), 10_000n);
  assert.equal(resolveX402AiPrice(env, undefined), 10_000n);
});

test("malformed JSON → flat pricing, never throws", () => {
  const env = makeEnv("{not valid json", 7_500n);
  assert.equal(resolveX402AiPrice(env, "claude-opus-4-8"), 7_500n);
  assert.deepEqual([...parseAiPriceMap(env).entries()], []);
});

test("non-object JSON (array/number) → empty map", () => {
  assert.deepEqual([...parseAiPriceMap(makeEnv("[1,2,3]")).entries()], []);
  assert.deepEqual([...parseAiPriceMap(makeEnv("42")).entries()], []);
});

test("skips bad entries but keeps good ones", () => {
  const env = makeEnv('{"good":5000,"zero":0,"neg":-5,"float":1.5,"str":"abc"}');
  const map = parseAiPriceMap(env);
  assert.equal(map.get("good"), 5_000n);
  assert.equal(map.has("zero"), false);
  assert.equal(map.has("neg"), false);
  assert.equal(map.has("float"), false);
  assert.equal(map.has("str"), false);
});

test("empty-object default behaves as flat pricing", () => {
  const env = makeEnv("{}", 10_000n);
  assert.equal(resolveX402AiPrice(env, "claude-opus-4-8"), 10_000n);
});
