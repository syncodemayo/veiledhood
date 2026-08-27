# Gate B — SolRouter SDK transport spike

**Date:** 2026-05-18
**Outcome:** ✅ Compatible with SOCKS5 Tor routing via a global-fetch monkey-patch scoped to the SolRouter base URL. No SDK fork required. ~10 lines of code in our service wrapper.

## What we wanted to know

Can we route all outbound calls from `@solrouter/sdk` through a SOCKS5 Tor proxy, without forking the SDK?

## Method

1. `npm install @solrouter/sdk@^1.0.1` in a sandbox dir
2. Inspected `node_modules/@solrouter/sdk/dist/client.js` directly
3. Searched the codebase for any HTTP/transport configuration knobs
4. Cross-referenced with the latest undici/`fetch-socks` patterns for Node 18+

## Findings

### SDK shape

- Package: `@solrouter/sdk@1.0.1`, ES module, MIT license
- Only runtime dependency: `@arcium-hq/client@^0.9.2`
- Default base URL: `https://solrouter-obb4.onrender.com` (currently on Render, NOT `api.solrouter.com`). Override via constructor `baseUrl` option.
- All HTTP calls use **bare `fetch(...)`** — no `axios`, no `node-fetch`, no `undici` import. Relies on Node 18+ built-in `fetch` (which is undici under the hood).
- Endpoints called: `POST /agent`, `POST /tee/process`, `POST /api/v1/balance`, plus a couple of plain-chat ones.
- Constructor accepts: `{ apiKey, baseUrl?, encrypted? }`. **No `dispatcher`, no `httpAgent`, no `fetch` override option.**

### Implication

We cannot inject a SOCKS5 proxy via the SDK's public API. But because the SDK uses bare `globalThis.fetch`, we can:

**Option 1 — global undici dispatcher** (`setGlobalDispatcher(socksDispatcher(...))`) — affects EVERY outbound `fetch` from the Node process. Too coarse: would route MongoDB-over-HTTP / other APIs through Tor too.

**Option 2 — patch `globalThis.fetch` with a URL-prefix router** — global patch, but the patched fetch only injects the SOCKS dispatcher when the destination matches SolRouter's base URL. Other outbound calls pass through unchanged. **This is the recommended path.**

**Option 3 — fork the SDK** to add a `dispatcher` constructor option. Cleanest long-term answer; submit upstream as a PR after Phase 1 ships. Out of scope for Phase 1 to avoid blocking on their review cycle.

### Recommended implementation pattern (Option 2)

In `api/src/services/solRouterClient.ts`:

```ts
import { SolRouter } from "@solrouter/sdk";
import { socksDispatcher } from "fetch-socks";
import type { Env } from "../config/env.js";

export function createSolRouterClient(env: Env): SolRouter {
  const baseUrl =
    env.SOLROUTER_BASE_URL?.trim() || "https://solrouter-obb4.onrender.com";

  if (env.TOR_ENABLED) {
    installTorProxyForBaseUrl(baseUrl, env.TOR_SOCKS_HOST, env.TOR_SOCKS_PORT);
  }

  return new SolRouter({ apiKey: env.SOLROUTER_API_KEY, baseUrl });
}

let installed = false;
function installTorProxyForBaseUrl(baseUrl: string, host: string, port: number): void {
  if (installed) return;
  const dispatcher = socksDispatcher({ type: 5, host, port });
  const originalFetch = globalThis.fetch;
  const prefix = baseUrl.replace(/\/+$/, "");

  globalThis.fetch = ((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith(prefix)) {
      // @ts-expect-error — undici accepts `dispatcher` in init, types may not advertise it
      return originalFetch(input, { ...init, dispatcher });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  installed = true;
}
```

Notes:
- Idempotent (`installed` flag) — safe to call from multiple modules or tests
- Only SolRouter's base URL is routed; other outbound traffic (Mongo, RPC, etc.) is untouched
- Falls back to direct fetch if `TOR_ENABLED=false` — useful for local dev when Tor daemon isn't running
- `fetch-socks` is the right lib: actively maintained, undici-compatible, MIT-licensed. https://github.com/Kaciras/fetch-socks

### Dependencies to add

```
npm i @solrouter/sdk@^1.0.1 fetch-socks@^1.3.0
```

(Note: `socks-proxy-agent` was in the original plan — fetch-socks replaces it for native fetch. The plan file should be updated to swap that out.)

### What this doesn't cover (still need to verify in build)

- **Streaming responses.** SolRouter's `/tee/process` endpoint may stream. Verify that the dispatcher pattern works with response streams (it should — undici dispatchers handle streams natively).
- **TLS handshake through Tor.** SOCKS5 + TLS works fine in principle, but if SolRouter's TLS config trips Tor exit nodes' anti-MITM heuristics, we may see handshake failures. Will know at first real call.
- **Connection reuse.** Each new circuit costs ~100–300ms. The dispatcher should keep-alive within circuit duration (~10 min). Confirm in load test.
- **Error messages.** When Tor circuits drop, undici typically throws `fetch failed` with a vague cause. We need to wrap with friendlier errors for the route handler to translate to user-facing messages.

## Conclusion

✅ **Gate B passes.** SolRouter SDK is compatible with server-side Tor routing via a URL-scoped fetch wrapper. ~10 lines in our `solRouterClient.ts` factory. No SDK fork needed for Phase 1.

Risk reduction for the broader plan:
- Risk #2 in the Phase 1 register ("SDK doesn't support custom transport") → DOWNGRADED from Medium/Low to LOW/LOW. Solved.

**Plan file change recommended:** swap `socks-proxy-agent@^10.0.0` for `fetch-socks@^1.3.0` in the dependency list.

## Sources

- `@solrouter/sdk@1.0.1` source at `/tmp/solrouter-spike/node_modules/@solrouter/sdk/dist/client.js`
- `fetch-socks` — https://github.com/Kaciras/fetch-socks
- undici `setGlobalDispatcher` reference — https://undici.nodejs.org/
- Node.js built-in `fetch` documentation — https://nodejs.org/api/globals.html#fetch
