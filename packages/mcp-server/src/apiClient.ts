import { loadSession } from "./session.js";
import { VeiledhoodMcpError } from "./errors.js";

const USER_AGENT = "veiledhood-mcp/0.1.0";
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 250;

export interface ApiRequestInit {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Body — must be JSON-serializable. */
  body?: unknown;
  /** Query params */
  query?: Record<string, string | number | undefined>;
  /** Per-request abort signal */
  signal?: AbortSignal;
}

export interface ApiResponse<T> {
  status: number;
  data: T;
}

function buildUrl(apiBase: string, path: string, query?: ApiRequestInit["query"]): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, apiBase);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Call a Veiledhood API endpoint with the cached session JWT.
 * Maps HTTP status to typed VeiledhoodMcpError on failure.
 */
export async function apiRequest<T>(path: string, init: ApiRequestInit = {}): Promise<ApiResponse<T>> {
  const session = await loadSession();
  const url = buildUrl(session.apiBase, path, init.query);
  const method = init.method ?? "GET";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.jwt}`,
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  let lastErr: unknown = undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: init.signal,
      });
      const ct = res.headers.get("content-type") ?? "";
      const json = ct.includes("application/json")
        ? ((await res.json()) as T)
        : ((await res.text()) as unknown as T);

      if (res.ok) return { status: res.status, data: json };

      // Map error statuses
      const errBody = json as any;
      const message = (errBody && typeof errBody === "object" && errBody.error) || res.statusText;
      switch (res.status) {
        case 401:
          throw new VeiledhoodMcpError("VEILEDHOOD_REAUTH_REQUIRED", "Veiledhood session expired or invalid.", { url });
        case 403:
          throw new VeiledhoodMcpError("VEILEDHOOD_API_FORBIDDEN", String(message), { url });
        case 404:
          throw new VeiledhoodMcpError("VEILEDHOOD_API_NOT_FOUND", String(message), { url });
        case 413:
          throw new VeiledhoodMcpError("VEILEDHOOD_VALIDATION_ERROR", String(message), { url });
        case 429: {
          const retryAfter = Number(res.headers.get("retry-after") ?? "5");
          throw new VeiledhoodMcpError(
            "VEILEDHOOD_API_RATE_LIMIT",
            `Veiledhood rate limit. Retry in ${retryAfter}s.`,
            { retryAfter },
          );
        }
        case 400:
        case 409:
          throw new VeiledhoodMcpError("VEILEDHOOD_VALIDATION_ERROR", String(message), { url });
        default:
          if (res.status >= 500 && attempt < MAX_RETRIES) {
            await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
            continue;
          }
          throw new VeiledhoodMcpError("VEILEDHOOD_API_SERVER_ERROR", String(message), { url, status: res.status });
      }
    } catch (e) {
      if (e instanceof VeiledhoodMcpError) throw e;
      lastErr = e;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      throw new VeiledhoodMcpError(
        "VEILEDHOOD_API_UNREACHABLE",
        `Cannot reach Veiledhood API: ${e instanceof Error ? e.message : String(e)}`,
        { url },
      );
    }
  }
  // Should never get here
  throw new VeiledhoodMcpError(
    "VEILEDHOOD_UNKNOWN",
    `Exhausted retries: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}
