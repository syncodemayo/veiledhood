import { test } from "node:test";
import assert from "node:assert/strict";
import type { Env } from "../config/env.js";
import { bridgeChainEnv, BridgeChainNotConfiguredError } from "./bridgeChainEnv.js";

const base = {
  RPC_URL: "https://base.rpc",
  VAULT_ADDRESS: "0xBaseVault000000000000000000000000000000",
  CHAIN_ID: 8453,
  BASE_CHAIN_ID: 8453,
  ETH_RPC_URL: "https://eth.rpc",
  ETH_VAULT_ADDRESS: "0xEthVault0000000000000000000000000000000",
  ETH_CHAIN_ID: 1,
  ADMIN_PRIVATE_KEY: "0x" + "1".repeat(64),
  SIGNER_PRIVATE_KEY: "0x" + "2".repeat(64),
} as unknown as Env;

test("returns base env for the Base chain id", () => {
  const e = bridgeChainEnv(base, 8453);
  assert.equal(e.RPC_URL, "https://base.rpc");
  assert.equal(e.VAULT_ADDRESS, "0xBaseVault000000000000000000000000000000");
  assert.equal(e.CHAIN_ID, 8453);
});

test("overrides with ETH config for the Eth chain id", () => {
  const e = bridgeChainEnv(base, 1);
  assert.equal(e.RPC_URL, "https://eth.rpc");
  assert.equal(e.VAULT_ADDRESS, "0xEthVault0000000000000000000000000000000");
  assert.equal(e.CHAIN_ID, 1);
});

test("throws for an unsupported chain id", () => {
  assert.throws(() => bridgeChainEnv(base, 137), /unsupported bridge chain/i);
});

test("throws when Eth requested but not configured", () => {
  const noEth = { ...base, ETH_RPC_URL: undefined, ETH_VAULT_ADDRESS: undefined } as Env;
  assert.throws(() => bridgeChainEnv(noEth, 1), BridgeChainNotConfiguredError);
});
