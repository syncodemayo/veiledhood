import { z } from "zod";
import { apiRequest } from "../apiClient.js";
import { VeiledhoodMcpError } from "../errors.js";
import type { McpToolResponse } from "./types.js";

export const contextShieldedInputShape = {
  chainId: z.number().int().positive().optional(),
};

const contextShieldedInputSchema = z.object(contextShieldedInputShape);
export type ContextShieldedInput = z.infer<typeof contextShieldedInputSchema>;

interface ShieldedItem {
  currency: string;
  amount: string;
  decimals?: number;
  symbol?: string;
  usdValue: number | null;
}

interface ShieldedResponse {
  address: string;
  chainId: number;
  balances: ShieldedItem[];
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

export async function handleContextShielded(
  input: ContextShieldedInput,
): Promise<McpToolResponse> {
  try {
    const res = await apiRequest<ShieldedResponse>("/context/shielded", {
      method: "POST",
      body: { chainId: input.chainId },
    });
    const lines: string[] = [];
    lines.push(`Shielded balances for ${res.data.address} (chain ${res.data.chainId}):`);
    lines.push(`Total: ${fmtUsd(res.data.totalUsd)}`);
    for (const b of res.data.balances) {
      const dec = b.decimals ?? 18;
      lines.push(
        `  ${(b.symbol ?? b.currency).padEnd(8)} ${fmtBalance(b.amount, dec).padStart(14)}  ${fmtUsd(b.usdValue)}`,
      );
    }
    if (res.data.balances.length === 0) lines.push("  (no shielded balances)");
    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (e) {
    if (e instanceof VeiledhoodMcpError) return e.toMcpContent();
    return new VeiledhoodMcpError(
      "VEILEDHOOD_UNKNOWN",
      `context_shielded failed: ${e instanceof Error ? e.message : String(e)}`,
    ).toMcpContent();
  }
}
