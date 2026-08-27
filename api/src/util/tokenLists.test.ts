import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getTokenList,
  getTokenByAddress,
  getTokenBySymbol,
  isSupportedChain,
  supportedChainIds,
} from "./tokenLists.js";

const BASE = 8453;
const ETHEREUM = 1;

test("isSupportedChain — supported chains", () => {
  assert.equal(isSupportedChain(BASE), true);
  assert.equal(isSupportedChain(ETHEREUM), true);
});

test("isSupportedChain — unsupported chain returns false", () => {
  assert.equal(isSupportedChain(137), false); // Polygon
  assert.equal(isSupportedChain(42161), false); // Arbitrum
});

test("supportedChainIds — includes Base + Ethereum", () => {
  const ids = supportedChainIds();
  assert.ok(ids.includes(BASE));
  assert.ok(ids.includes(ETHEREUM));
});

test("getTokenList — Base list is non-empty + contains USDC and WETH", () => {
  const list = getTokenList(BASE);
  assert.ok(list.length >= 10);
  assert.ok(list.some((t) => t.symbol === "USDC"));
  assert.ok(list.some((t) => t.symbol === "WETH"));
});

test("getTokenList — Ethereum list is non-empty + contains USDC, USDT, WETH", () => {
  const list = getTokenList(ETHEREUM);
  assert.ok(list.length >= 10);
  assert.ok(list.some((t) => t.symbol === "USDC"));
  assert.ok(list.some((t) => t.symbol === "USDT"));
  assert.ok(list.some((t) => t.symbol === "WETH"));
});

test("getTokenList — unsupported chain returns empty array, not throws", () => {
  const list = getTokenList(999);
  assert.equal(list.length, 0);
});

test("all addresses lowercase + checksum-valid length", () => {
  for (const chainId of supportedChainIds()) {
    for (const t of getTokenList(chainId)) {
      assert.match(t.address, /^0x[a-f0-9]{40}$/, `bad address: ${t.symbol} ${t.address}`);
    }
  }
});

test("no duplicate addresses within a chain", () => {
  for (const chainId of supportedChainIds()) {
    const list = getTokenList(chainId);
    const addrs = new Set(list.map((t) => t.address));
    assert.equal(addrs.size, list.length, `chain ${chainId} has duplicate addresses`);
  }
});

test("decimals between 0 and 24 inclusive", () => {
  for (const chainId of supportedChainIds()) {
    for (const t of getTokenList(chainId)) {
      assert.ok(t.decimals >= 0 && t.decimals <= 24, `bad decimals: ${t.symbol} ${t.decimals}`);
    }
  }
});

test("getTokenByAddress — case-insensitive lookup", () => {
  const usdc = getTokenByAddress(BASE, "0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913");
  assert.ok(usdc);
  assert.equal(usdc.symbol, "USDC");
});

test("getTokenByAddress — unknown address returns undefined", () => {
  assert.equal(getTokenByAddress(BASE, "0x0000000000000000000000000000000000000000"), undefined);
});

test("getTokenBySymbol — case-insensitive lookup", () => {
  const weth = getTokenBySymbol(ETHEREUM, "weth");
  assert.ok(weth);
  assert.equal(weth.symbol, "WETH");
});

test("USDC has pythSymbol set on both chains", () => {
  assert.equal(getTokenBySymbol(BASE, "USDC")?.pythSymbol, "Crypto.USDC/USD");
  assert.equal(getTokenBySymbol(ETHEREUM, "USDC")?.pythSymbol, "Crypto.USDC/USD");
});
