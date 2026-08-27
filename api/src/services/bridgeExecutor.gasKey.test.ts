import { test } from "node:test";
import assert from "node:assert/strict";
import type { Env } from "../config/env.js";
import { resolveBridgeGasKey } from "./bridgeExecutor.js";

const ADMIN = "0x" + "a".repeat(64);
const GAS = "0x" + "b".repeat(64);

test("falls back to ADMIN_PRIVATE_KEY when BRIDGE_GAS_PRIVATE_KEY unset", () => {
  const env = { ADMIN_PRIVATE_KEY: ADMIN } as unknown as Env;
  assert.equal(resolveBridgeGasKey(env), ADMIN);
});

test("prefers BRIDGE_GAS_PRIVATE_KEY over ADMIN_PRIVATE_KEY when set", () => {
  const env = { ADMIN_PRIVATE_KEY: ADMIN, BRIDGE_GAS_PRIVATE_KEY: GAS } as unknown as Env;
  assert.equal(resolveBridgeGasKey(env), GAS);
});

test("ignores a blank BRIDGE_GAS_PRIVATE_KEY and uses admin", () => {
  const env = { ADMIN_PRIVATE_KEY: ADMIN, BRIDGE_GAS_PRIVATE_KEY: "   " } as unknown as Env;
  assert.equal(resolveBridgeGasKey(env), ADMIN);
});

test("returns empty string when neither is configured", () => {
  const env = {} as unknown as Env;
  assert.equal(resolveBridgeGasKey(env), "");
});
