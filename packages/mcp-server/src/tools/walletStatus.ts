import { loadSession } from "../session.js";
import { apiRequest } from "../apiClient.js";
import { VeiledhoodMcpError } from "../errors.js";
import type { McpToolResponse } from "./types.js";

const VERSION = "0.1.0";

/**
 * Confirms the MCP server can reach Veiledhood and reports the authenticated
 * wallet address. Hits `/user/me` to verify the JWT is alive end-to-end; if
 * the backend is unreachable, falls back to a session-only OK with a note.
 */
export async function handleWalletStatus(): Promise<McpToolResponse> {
  try {
    const session = await loadSession();
    const expIso = new Date(session.exp * 1000).toISOString();

    let backendNote = "Backend OK.";
    try {
      await apiRequest<{ address: string }>("/user/me");
    } catch (e) {
      if (e instanceof VeiledhoodMcpError && e.code === "VEILEDHOOD_REAUTH_REQUIRED") {
        // Surface re-auth properly
        return e.toMcpContent();
      }
      backendNote = `Backend unreachable (${e instanceof VeiledhoodMcpError ? e.code : "unknown"}). Session file is valid; retry later.`;
    }

    return {
      content: [
        {
          type: "text",
          text:
            `Veiledhood MCP v${VERSION} authenticated as ${session.address}. ` +
            `Session expires ${expIso}. ${backendNote}`,
        },
      ],
    };
  } catch (e) {
    if (e instanceof VeiledhoodMcpError) return e.toMcpContent();
    return new VeiledhoodMcpError(
      "VEILEDHOOD_UNKNOWN",
      `wallet_status failed: ${e instanceof Error ? e.message : String(e)}`,
    ).toMcpContent();
  }
}
