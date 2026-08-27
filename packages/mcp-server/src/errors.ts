/**
 * Typed errors for MCP tool responses. The MCP client (Claude Code etc.)
 * shows the `userMessage` to the user, while `code` lets a programmatic
 * agent dispatch on a stable string.
 */
export type VeiledhoodMcpErrorCode =
  | "VEILEDHOOD_REAUTH_REQUIRED"
  | "VEILEDHOOD_SESSION_FILE_MISSING"
  | "VEILEDHOOD_SESSION_FILE_MALFORMED"
  | "VEILEDHOOD_SESSION_FILE_INSECURE"
  | "VEILEDHOOD_MASTER_KEY_MISSING"
  | "VEILEDHOOD_MASTER_KEY_MALFORMED"
  | "VEILEDHOOD_DECRYPT_FAILED"
  | "VEILEDHOOD_ENCRYPT_FAILED"
  | "VEILEDHOOD_API_UNREACHABLE"
  | "VEILEDHOOD_API_RATE_LIMIT"
  | "VEILEDHOOD_API_FORBIDDEN"
  | "VEILEDHOOD_API_NOT_FOUND"
  | "VEILEDHOOD_API_SERVER_ERROR"
  | "VEILEDHOOD_VALIDATION_ERROR"
  | "VEILEDHOOD_X402_KEY_DERIVATION_FAILED"
  | "VEILEDHOOD_X402_CLIENT_INIT_FAILED"
  | "VEILEDHOOD_X402_PRICE_TOO_HIGH"
  | "VEILEDHOOD_X402_UNSUPPORTED"
  | "VEILEDHOOD_X402_INVALID_CHALLENGE"
  | "VEILEDHOOD_X402_FETCH_FAILED"
  | "VEILEDHOOD_X402_HTTP_ERROR"
  | "VEILEDHOOD_UNKNOWN";

export class VeiledhoodMcpError extends Error {
  constructor(
    public readonly code: VeiledhoodMcpErrorCode,
    public readonly userMessage: string,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(userMessage);
    this.name = "VeiledhoodMcpError";
  }
  toMcpContent(): { content: Array<{ type: "text"; text: string }>; isError: true } {
    return {
      content: [{ type: "text", text: `[${this.code}] ${this.userMessage}` }],
      isError: true,
    };
  }
}
