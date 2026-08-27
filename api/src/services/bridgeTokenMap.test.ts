import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDestBridgeCurrency } from "./bridgeTokenMap.js";

const BASE = 8453;
const ETH = 1;
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ETH_USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

test("USDC Base->Eth maps to the Ethereum USDC address (not the source address)", () => {
  const dst = resolveDestBridgeCurrency(BASE_USDC, BASE, ETH);
  assert.equal(dst.toLowerCase(), ETH_USDC);
  assert.notEqual(dst.toLowerCase(), BASE_USDC);
});

test("USDC Eth->Base maps to the Base USDC address", () => {
  const dst = resolveDestBridgeCurrency(ETH_USDC, ETH, BASE);
  assert.equal(dst.toLowerCase(), BASE_USDC);
});

test("native ETH is chain-agnostic both directions", () => {
  assert.equal(resolveDestBridgeCurrency("native", BASE, ETH), "native");
  assert.equal(resolveDestBridgeCurrency("native", ETH, BASE), "native");
});

test("address is matched case-insensitively", () => {
  const dst = resolveDestBridgeCurrency(BASE_USDC.toUpperCase().replace("0X", "0x"), BASE, ETH);
  assert.equal(dst.toLowerCase(), ETH_USDC);
});

test("throws for an unlisted source token", () => {
  assert.throws(
    () => resolveDestBridgeCurrency("0x" + "9".repeat(40), BASE, ETH),
    /Unsupported bridge asset/
  );
});
