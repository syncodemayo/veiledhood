import { getX402PayerContext } from "../x402Payer.js";
import { VeiledhoodMcpError } from "../errors.js";
import type { McpToolResponse } from "./types.js";

/**
 * `x402_payer_info` — returns the derived per-user x402 payer EOA address +
 * chain + RPC URL. Use this before `pay_x402` so the user knows where to
 * deposit USDC.
 *
 * Address is deterministic: same master.key → same payer EOA across runs.
 *
 * No on-chain balance read — that would leak the address to the RPC provider
 * before the user explicitly asks. The user (or a wallet UI) can check
 * balance themselves on basescan.
 */
export async function handleX402PayerInfo(): Promise<McpToolResponse> {
  try {
    const payer = await getX402PayerContext();
    const network = payer.chainId === 8453 ? "Base mainnet" : `chain ${payer.chainId}`;
    return {
      content: [
        {
          type: "text",
          text:
            `x402 payer wallet (derived from your master.key):\n` +
            `  Address: ${payer.payerAddress}\n` +
            `  Network: ${network} (chainId ${payer.chainId})\n` +
            `  RPC:     ${payer.rpcUrl}\n` +
            `\n` +
            `Fund this address with USDC on Base before calling pay_x402.\n` +
            `USDC contract on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\n` +
            `Basescan: https://basescan.org/address/${payer.payerAddress}`,
        },
      ],
    };
  } catch (e) {
    if (e instanceof VeiledhoodMcpError) return e.toMcpContent();
    return new VeiledhoodMcpError(
      "VEILEDHOOD_UNKNOWN",
      `x402_payer_info failed: ${e instanceof Error ? e.message : String(e)}`,
    ).toMcpContent();
  }
}
