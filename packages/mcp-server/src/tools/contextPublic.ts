import { z } from "zod";
import { apiRequest } from "../apiClient.js";
import { VeiledhoodMcpError } from "../errors.js";
import type { McpToolResponse } from "./types.js";

export const contextPublicInputShape = {
  chainId: z.number().int().positive().optional(),
};

const contextPublicInputSchema = z.object(contextPublicInputShape);
export type ContextPublicInput = z.infer<typeof contextPublicInputSchema>;

interface PublicTokenItem {
  address: string;
  symbol: string;
  decimals: number;
  balance: string;
  priceUsd: number | null;
  usdValue: number | null;
}

interface PublicNative {
  symbol: string;
  balance: string;
  priceUsd: number | null;
  usdValue: number | null;
}

interface PublicResponse {
  address: string;
  chainId: number;
  native: PublicNative;
  tokens: PublicTokenItem[];
  totalUsd: number | null;
  at: number;
}

function fmtUsd(v: number | null): string {
  if (v === null) return "—";
  if (v === 0) return "$0";
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtBalance(raw: string, decimals: number): string {
  try {
    const big = BigInt(raw);
    if (big === 0n) return "0";
    const whole = big / 10n ** BigInt(decimals);
    const frac = big % 10n ** BigInt(decimals);
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
    return fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
  } catch {
    return raw;
  }
}

export async function handleContextPublic(
  input: ContextPublicInput,
): Promise<McpToolResponse> {
  try {
    const res = await apiRequest<PublicResponse>("/context/public", {
      method: "POST",
      body: { chainId: input.chainId },
    });
    const lines: string[] = [];
    lines.push(`Public on-chain balances for ${res.data.address} (chain ${res.data.chainId}):`);
    lines.push(`Total: ${fmtUsd(res.data.totalUsd)}`);
    lines.push(
      `  ${res.data.native.symbol.padEnd(8)} ${fmtBalance(res.data.native.balance, 18).padStart(14)}  ${fmtUsd(res.data.native.usdValue)}  (native)`,
    );
    const nonZero = res.data.tokens.filter((t) => t.balance !== "0");
    for (const t of nonZero) {
      lines.push(
        `  ${t.symbol.padEnd(8)} ${fmtBalance(t.balance, t.decimals).padStart(14)}  ${fmtUsd(t.usdValue)}`,
      );
    }
    if (nonZero.length === 0) lines.push("  (no ERC-20 balances in the tracked token list)");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (e) {
    if (e instanceof VeiledhoodMcpError) return e.toMcpContent();
    return new VeiledhoodMcpError(
      "VEILEDHOOD_UNKNOWN",
      `context_public failed: ${e instanceof Error ? e.message : String(e)}`,
    ).toMcpContent();
  }
}
