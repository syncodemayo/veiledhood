import { hexToBytes } from "viem";
import { createAgentIdentity, encodeMetaAddress } from "@shroud-fi/core";
import { createTransport, type ShroudFiTransport } from "@shroud-fi/transport";
import type { Env } from "../config/env.js";

/**
 * Server-side ShroudFi identity for accepting stealth-addressed x402 payments.
 *
 * What lives here:
 *   - The ShroudFiTransport (publicClient + walletClient bound to the chain).
 *   - The recipient meta-address (deterministically derived from
 *     SHROUDFI_MASTER_SEED — pin this in env so it survives restarts).
 *   - The agent EOA address (gas payer for register / sweep paths).
 *
 * What does NOT live here:
 *   - The full ShroudAgent class with scanner — that boots in a separate
 *     process (services/x402Scanner.ts) so the API never blocks on chain reads.
 *
 * Privacy note: never log SHROUDFI_MASTER_SEED bytes. Only `metaAddress` (the
 * public identifier) and `agentAddress` (the public gas-payer EOA) are safe
 * for logs. The seed is the spend key.
 */

interface ShroudFiContext {
  readonly transport: ShroudFiTransport;
  readonly recipientMetaAddress: string;
  readonly agentAddress: `0x${string}` | undefined;
  readonly masterSeedBytes: Uint8Array;
}

let cached: ShroudFiContext | null = null;

export class ShroudFiNotConfiguredError extends Error {
  constructor(reason: string) {
    super(`ShroudFi not configured: ${reason}`);
    this.name = "ShroudFiNotConfiguredError";
  }
}

export function isShroudFiReady(env: Env): boolean {
  return Boolean(
    env.X402_ENABLED &&
      env.BASE_RPC_URL?.trim() &&
      env.SHROUDFI_MASTER_SEED?.trim(),
  );
}

export function getShroudFiContext(env: Env): ShroudFiContext {
  if (cached !== null) return cached;
  if (!env.X402_ENABLED) {
    throw new ShroudFiNotConfiguredError("X402_ENABLED is false");
  }
  if (!env.BASE_RPC_URL?.trim()) {
    throw new ShroudFiNotConfiguredError("BASE_RPC_URL missing");
  }
  if (!env.SHROUDFI_MASTER_SEED?.trim()) {
    throw new ShroudFiNotConfiguredError("SHROUDFI_MASTER_SEED missing");
  }

  const masterSeedBytes = hexToBytes(env.SHROUDFI_MASTER_SEED as `0x${string}`);
  if (masterSeedBytes.length !== 32) {
    throw new ShroudFiNotConfiguredError("SHROUDFI_MASTER_SEED must decode to 32 bytes");
  }

  const identity = createAgentIdentity(masterSeedBytes);
  const recipientMetaAddress = encodeMetaAddress(identity.metaAddress);

  // Build the transport. walletClient is present iff we have an agent private
  // key — required only for the scanner / register paths, not for x402
  // verify/challenge.
  const transport = createTransport({
    chain: env.SHROUDFI_CHAIN,
    rpcUrl: env.BASE_RPC_URL,
    ...(env.SHROUDFI_AGENT_PRIVATE_KEY
      ? { privateKey: env.SHROUDFI_AGENT_PRIVATE_KEY as `0x${string}` }
      : {}),
  });

  const agentAddress = transport.walletClient?.account?.address;

  cached = {
    transport,
    recipientMetaAddress,
    agentAddress,
    masterSeedBytes,
  };

  console.log(
    `[veiledhood-x402] ShroudFi ready chain=${env.SHROUDFI_CHAIN} meta=${recipientMetaAddress.slice(0, 28)}… agent=${agentAddress?.slice(0, 10) ?? "(no-wallet)"}…`,
  );

  return cached;
}

export function resetShroudFiCacheForTests(): void {
  cached = null;
}
