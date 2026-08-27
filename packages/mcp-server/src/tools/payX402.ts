import { z } from "zod";
import { getX402PayerContext } from "../x402Payer.js";
import { VeiledhoodMcpError } from "../errors.js";
import type { McpToolResponse } from "./types.js";

/**
 * `pay_x402` — call an HTTP endpoint that returns 402 Payment Required, sign
 * the EIP-3009 USDC authorization, and return the unlocked body.
 *
 * Flow:
 *   1. Derive (or reuse cached) per-user x402 payer EOA from master.key.
 *   2. Fetch `url`. If 200/non-402: return as-is.
 *   3. If 402: parse the challenge, enforce `maxUsdAtomic` safety cap, sign
 *      EIP-3009 from the derived EOA, retry with `X-PAYMENT`, return body
 *      + the on-chain settlement tx hash if the server attached one.
 *
 * Funding: the derived EOA must hold USDC on Base. First call surfaces the
 * address so the user can deposit before retrying.
 *
 * Privacy:
 *   - The user's main wallet never signs the x402 authorization. The payer
 *     EOA is HKDF-derived from master.key and lives only on the user's
 *     machine.
 *   - Different x402 payments share this same payer EOA — receivers can
 *     correlate but no link to the user's main wallet exists.
 *   - Receiving servers that use ShroudFi (e.g. Veiledhood's own /ai/chat)
 *     settle the EIP-3009 to a FRESH stealth address per call, so neither
 *     side of the payment graph is publicly reconstructable.
 */

export const payX402InputShape = {
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).optional(),
  body: z.unknown().optional(),
  headers: z.record(z.string()).optional(),
  /** Max USDC the user is willing to spend on this call. Defaults to $0.10. */
  maxUsd: z.number().positive().max(10).optional(),
  /** Treat any 4xx response after payment as an error to surface to the LLM. */
  failOnHttpError: z.boolean().optional(),
};

export const payX402InputSchema = z.object(payX402InputShape);
export type PayX402Input = z.infer<typeof payX402InputSchema>;

function toAtomicUsdc(maxUsd: number): bigint {
  // 6-decimal USDC. Round UP so the budget covers the receiver's stated price.
  return BigInt(Math.ceil(maxUsd * 1_000_000));
}

export async function handlePayX402(input: PayX402Input): Promise<McpToolResponse> {
  try {
    const payer = await getX402PayerContext();
    const maxUsd = input.maxUsd ?? 0.1;
    const maxPriceAtomic = toAtomicUsdc(maxUsd);

    const method = (input.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = { ...(input.headers ?? {}) };
    let body: BodyInit | undefined;
    if (input.body !== undefined && method !== "GET" && method !== "DELETE") {
      headers["content-type"] = headers["content-type"] ?? "application/json";
      body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
    }

    const startedAt = Date.now();
    let response;
    try {
      response = await payer.client.fetch(input.url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        maxPriceAtomic,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // ShroudFi throws X402AmountMismatchError when server demands > maxPrice.
      if (msg.includes("AmountMismatch") || msg.includes("amount_mismatch")) {
        return new VeiledhoodMcpError(
          "VEILEDHOOD_X402_PRICE_TOO_HIGH",
          `Server price exceeded maxUsd cap of $${maxUsd}. Raise maxUsd to retry.`,
        ).toMcpContent();
      }
      if (msg.includes("AssetNotSupported") || msg.includes("asset_not_supported")) {
        return new VeiledhoodMcpError(
          "VEILEDHOOD_X402_UNSUPPORTED",
          `Endpoint priced in a non-USDC asset or non-Base network. v1 only supports USDC on Base.`,
        ).toMcpContent();
      }
      if (msg.includes("InvalidChallenge") || msg.includes("invalid_challenge")) {
        return new VeiledhoodMcpError(
          "VEILEDHOOD_X402_INVALID_CHALLENGE",
          `Server returned a malformed 402 challenge: ${msg}`,
        ).toMcpContent();
      }
      return new VeiledhoodMcpError(
        "VEILEDHOOD_X402_FETCH_FAILED",
        `pay_x402 fetch failed for ${input.url}: ${msg}`,
      ).toMcpContent();
    }

    const elapsedMs = Date.now() - startedAt;
    const settlement = response.x402Settlement;
    const status = response.status;

    let bodyText: string;
    try {
      bodyText = await response.text();
    } catch (e) {
      bodyText = `<could not read body: ${e instanceof Error ? e.message : String(e)}>`;
    }

    // After-payment error surface (server returned 4xx/5xx despite our payment).
    if (input.failOnHttpError && (status < 200 || status >= 300)) {
      return new VeiledhoodMcpError(
        "VEILEDHOOD_X402_HTTP_ERROR",
        `Endpoint returned ${status} after payment: ${bodyText.slice(0, 500)}`,
      ).toMcpContent();
    }

    // Truncate very large bodies — LLMs don't need megabytes of HTML.
    const renderedBody =
      bodyText.length > 8_000
        ? `${bodyText.slice(0, 8_000)}\n\n…(truncated, ${bodyText.length - 8_000} more bytes)`
        : bodyText;

    const summaryLines = [
      `HTTP ${status} ${response.statusText}`,
      `Elapsed: ${elapsedMs}ms`,
      settlement !== undefined
        ? `Settled tx: ${settlement.txHash} (${new Date(settlement.settledAt * 1000).toISOString()})`
        : `Settlement: none (server didn't return X-PAYMENT-RESPONSE, or this call didn't require payment)`,
      `Payer EOA: ${payer.payerAddress} (Base) — top up with USDC if you see 402 retries.`,
      "",
      "--- Response body ---",
      renderedBody,
    ];

    return {
      content: [
        {
          type: "text",
          text: summaryLines.join("\n"),
        },
      ],
    };
  } catch (e) {
    if (e instanceof VeiledhoodMcpError) return e.toMcpContent();
    return new VeiledhoodMcpError(
      "VEILEDHOOD_UNKNOWN",
      `pay_x402 failed: ${e instanceof Error ? e.message : String(e)}`,
    ).toMcpContent();
  }
}
