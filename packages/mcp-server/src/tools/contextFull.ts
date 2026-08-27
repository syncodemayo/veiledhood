import { z } from "zod";
import { apiRequest } from "../apiClient.js";
import { VeiledhoodMcpError } from "../errors.js";
import type { McpToolResponse } from "./types.js";

/**
 * NOTE: `inputSchema` must be a ZodRawShape (plain object of fields), NOT
 * a z.object({...}). See schema-shape.test.ts for the regression guard.
 */
export const contextFullInputShape = {
  chainId: z.number().int().positive().optional(),
};

const contextFullInputSchema = z.object(contextFullInputShape);
export type ContextFullInput = z.infer<typeof contextFullInputSchema>;

interface PublicNative {
  symbol: string;
  balance: string;
  priceUsd: number | null;
  usdValue: number | null;
}

interface PublicTokenItem {
  address: string;
  symbol: string;
  decimals: number;
  balance: string;
  priceUsd: number | null;
  usdValue: number | null;
}

interface ShieldedItem {
  currency: string;
  amount: string;
  decimals?: number;
  symbol?: string;
  usdValue: number | null;
}

interface FullResponse {
  address: string;
  chainId: number;
  shielded: {
    balances: ShieldedItem[];
    totalUsd: number | null;
  };
  public: {
    native: PublicNative;
    tokens: PublicTokenItem[];
    totalUsd: number | null;
  };
  totalUsd: number | null;
  at: number;
  privacy: { decoyRatio: number; batchWindowMs: number };
}

function fmtUsd(v: number | null): string {
  if (v === null) return "—";
  if (v === 0) return "$0";
  if (Math.abs(v) < 0.01) return "<$0.01";
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

function formatFull(r: FullResponse): string {
  const lines: string[] = [];
  lines.push(`Wallet context for ${r.address} on chain ${r.chainId}`);
  lines.push(`Total: ${fmtUsd(r.totalUsd)}`);
  lines.push("");
  lines.push(`Shielded (Veiledhood): ${fmtUsd(r.shielded.totalUsd)}`);
  for (const b of r.shielded.balances) {
    const dec = b.decimals ?? 18;
    lines.push(`  ${(b.symbol ?? b.currency).padEnd(8)} ${fmtBalance(b.amount, dec).padStart(14)}  ${fmtUsd(b.usdValue)}`);
  }
  if (r.shielded.balances.length === 0) lines.push("  (none)");
  lines.push("");
  lines.push(`Public (chain ${r.chainId}): ${fmtUsd(r.public.totalUsd)}`);
  lines.push(`  ${r.public.native.symbol.padEnd(8)} ${fmtBalance(r.public.native.balance, 18).padStart(14)}  ${fmtUsd(r.public.native.usdValue)}`);
  const nonZeroTokens = r.public.tokens.filter((t) => t.balance !== "0");
  for (const t of nonZeroTokens) {
    lines.push(`  ${t.symbol.padEnd(8)} ${fmtBalance(t.balance, t.decimals).padStart(14)}  ${fmtUsd(t.usdValue)}`);
  }
  if (nonZeroTokens.length === 0) lines.push("  (no public ERC-20 balances)");
  return lines.join("\n");
}

export async function handleContextFull(input: ContextFullInput): Promise<McpToolResponse> {
  try {
    const res = await apiRequest<FullResponse>("/context/full", {
      method: "POST",
      body: { chainId: input.chainId },
    });
    return { content: [{ type: "text", text: formatFull(res.data) }] };
  } catch (e) {
    if (e instanceof VeiledhoodMcpError) return e.toMcpContent();
    return new VeiledhoodMcpError(
      "VEILEDHOOD_UNKNOWN",
      `context_full failed: ${e instanceof Error ? e.message : String(e)}`,
    ).toMcpContent();
  }
}
