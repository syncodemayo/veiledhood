import type { Env } from "../config/env.js";

export class BridgeChainNotConfiguredError extends Error {
  constructor(chainId: number) {
    super(`bridge chain ${chainId} not configured (missing RPC_URL/VAULT_ADDRESS)`);
    this.name = "BridgeChainNotConfiguredError";
  }
}

/** Resolve the effective per-chain Env so Base-assuming helpers work for either chain. */
export function bridgeChainEnv(env: Env, chainId: number): Env {
  const baseId = env.CHAIN_ID ?? env.BASE_CHAIN_ID ?? 8453;
  const ethId = env.ETH_CHAIN_ID ?? 1;

  if (chainId === baseId) {
    if (!env.RPC_URL?.trim() || !env.VAULT_ADDRESS?.trim()) {
      throw new BridgeChainNotConfiguredError(chainId);
    }
    return { ...env, CHAIN_ID: baseId };
  }
  if (chainId === ethId) {
    if (!env.ETH_RPC_URL?.trim() || !env.ETH_VAULT_ADDRESS?.trim()) {
      throw new BridgeChainNotConfiguredError(chainId);
    }
    return {
      ...env,
      RPC_URL: env.ETH_RPC_URL.trim(),
      VAULT_ADDRESS: env.ETH_VAULT_ADDRESS,
      CHAIN_ID: ethId,
    };
  }
  throw new Error(`unsupported bridge chain id ${chainId}`);
}
