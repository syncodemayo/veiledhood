import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createTransport, type ShroudFiTransport } from "@shroud-fi/transport";
import { createX402Client, type X402Client } from "@shroud-fi/x402";
import { loadMasterKey } from "./keys.js";
import { VeiledhoodMcpError } from "./errors.js";

/**
 * Per-user x402 payer (sender side).
 *
 * Derives a deterministic Base EOA from the user's existing master.key via
 * HKDF — same machine, same master.key, same payer address. The user funds
 * that address with USDC once; subsequent `pay_x402` calls sign EIP-3009
 * authorizations from it.
 *
 * Privacy upgrade over no-derivation:
 *   - User's main wallet never appears as the x402 `from` field.
 *   - The HKDF derivation hides the link between main wallet and payer EOA.
 *
 * Privacy limitation in v1:
 *   - Every outbound x402 payment shares the SAME payer EOA. Different
 *     receivers can correlate calls (they all came from the same address).
 *   - Sender-side stealth rotation (a fresh address per payment) is v2 —
 *     requires the user to first deposit USDC to themselves via stealth,
 *     then spend from those stealth addresses. Adds substantial UX friction.
 */

const HKDF_INFO_X402_PAYER = new TextEncoder().encode("veiledhood-x402-payer-v1");
const HKDF_SALT_X402_PAYER = new TextEncoder().encode("veiledhood/x402/payer/salt/v1");

interface X402PayerContext {
  readonly client: X402Client;
  readonly transport: ShroudFiTransport;
  readonly payerAddress: `0x${string}`;
  readonly chainId: number;
  readonly rpcUrl: string;
}

let cached: X402PayerContext | null = null;

function defaultBaseRpc(): string {
  // Coinbase's public Base mainnet RPC. Free, no auth, no key needed.
  return process.env.VEILEDHOOD_BASE_RPC_URL ?? "https://mainnet.base.org";
}

function defaultChain(): "base" | "baseSepolia" {
  const v = (process.env.VEILEDHOOD_X402_CHAIN ?? "base").toLowerCase();
  return v === "basesepolia" ? "baseSepolia" : "base";
}

export async function getX402PayerContext(): Promise<X402PayerContext> {
  if (cached !== null) return cached;

  const { rawKey } = await loadMasterKey();

  // HKDF-SHA256 → 32-byte secret used as the EOA private key. Domain-separated
  // from any other key derivation (encrypted-data, future delegated scan keys).
  let derived: Uint8Array;
  try {
    derived = hkdf(sha256, rawKey, HKDF_SALT_X402_PAYER, HKDF_INFO_X402_PAYER, 32);
  } catch (e) {
    throw new VeiledhoodMcpError(
      "VEILEDHOOD_X402_KEY_DERIVATION_FAILED",
      `Could not derive x402 payer key from master.key: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const privateKey = bytesToHex(derived) as `0x${string}`;
  const account = privateKeyToAccount(privateKey);

  const rpcUrl = defaultBaseRpc();
  const chain = defaultChain();

  const transport = createTransport({
    chain,
    rpcUrl,
    privateKey,
  });

  let client: X402Client;
  try {
    client = createX402Client({ transport });
  } catch (e) {
    throw new VeiledhoodMcpError(
      "VEILEDHOOD_X402_CLIENT_INIT_FAILED",
      `Could not initialize x402 client: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  cached = {
    client,
    transport,
    payerAddress: account.address,
    chainId: transport.chain.id,
    rpcUrl,
  };

  return cached;
}

export function clearX402PayerCache(): void {
  cached = null;
}
