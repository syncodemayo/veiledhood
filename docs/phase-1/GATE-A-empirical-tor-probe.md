# Gate A — empirical Tor compatibility probe

**Date:** 2026-05-18
**Outcome:** ✅ **PASS**. SolRouter does not block our Tor exit IP. Build unblocked.

## What we ran

Local Tor daemon (Tor 0.4.8.16 on Windows) listening SOCKS5 on `127.0.0.1:9050`. Node script using `@solrouter/sdk@1.0.1` + `fetch-socks@1.3.3` + `undici@8.3.0`, with `globalThis.fetch` monkey-patched to inject the SOCKS5 dispatcher only for the SolRouter base URL.

Probe at `tor-spike/probe/probe.mjs` (kept locally, NOT committed):
- 10 trials
- Each trial: `client.getBalance()` then `client.chat("Reply with the single word: pong", { model: "gpt-oss-20b", maxTokens: 8 })`
- 800ms between trials

## Results

| Metric | Value |
|---|---|
| `getBalance()` success | 10/10 |
| `chat()` success | 10/10 |
| Unique Tor exit IPs observed | 1 (`107.189.13.254`) |
| Balance latency p50 | ~825 ms |
| Chat latency p50 / p95 | 3543 ms / 7921 ms |
| HTTP errors / Tor failures | 0 |
| Cost (estimated) | < $0.01 USDC |

Single exit IP is expected — Tor reuses a circuit until it ages out (~10 min default). For stream isolation across users we will use the `userId` SOCKS5 auth trick (different username per Veiledhood user → Tor opens a new circuit per user).

## Critical finding — undici version pin

Node 24.13.1 ships bundled `undici@7.18.2`. `fetch-socks@1.3.3` declares `undici: >=7` but internally bundles `undici@8.3.0`, and the dispatcher it returns implements the **v8 interceptor API** (`onRequestStart` etc.), which Node's bundled v7 rejects with `InvalidArgumentError: invalid onRequestStart method UND_ERR_INVALID_ARG`.

**Resolution:** install `undici@^8.3.0` as a direct dependency in `api/`, and use `import { fetch as undiciFetch } from "undici"` for the SolRouter call path (don't rely on `globalThis.fetch`). The patched `globalThis.fetch` should also call into `undiciFetch` for consistency.

**Alternative:** pin Node to 22 LTS (whose bundled undici is older and compatible with the dispatcher). Less attractive — Node 22 EOL sooner than 24.

**Decision:** add `undici@^8.3.0` to `api/package.json`. Document the reason in code comment.

## What this DOESN'T prove (future risks)

- **Single circuit only.** Today's probe used one Tor circuit (one exit IP). Production will rotate circuits via SOCKS auth stream isolation. Some circuits may use exits SolRouter does block. Mitigation: wrap the call with retry-on-error → request new circuit via different SOCKS userId. Add metric: % of retries per minute.
- **Render hosting visibility.** SolRouter is currently hosted at `solrouter-obb4.onrender.com`. If they later add a Cloudflare/CDN layer that blocks Tor by default, this probe becomes stale. Re-run pre-launch.
- **Streaming responses.** Probe used non-streaming chat. The `/tee/process` endpoint may stream — verify in actual build.
- **Sustained load.** Probe was 10 sequential calls. Production batched/concurrent traffic may behave differently.

## Implications for Phase 1

- ✅ Empirical Gate A passes — proceed to Task #13 (code build).
- ✅ Tor compatibility paper trail recorded.
- ⏳ Email reply from SolRouter still valuable but no longer blocking.
- ⚠️ Add `undici@^8.3.0` to dependency list.
- ⚠️ Stream isolation per user must be in the build (`socks5 username = veiledhood user JWT subject hash`).
- ⚠️ Add retry-with-new-circuit logic for production resilience.
- ℹ️ Treasury at $10 USDC — fine for staging. Bump to $200–500 before launching to real users.

## Cleanup

Probe sandbox at `C:\Users\Home\Desktop\Claude\tor-spike` is local-only and gitignored (path is outside the repo). Tor daemon stopped after probe completion.

## Sources

- Probe output: see `latencies` and `balance:10/10 ok` rows in the 2026-05-18 probe run.
- fetch-socks: https://github.com/Kaciras/fetch-socks
- undici interceptor API change between v7/v8: undici release notes.
- Tor stream isolation via SOCKS auth: `man tor.1` section `IsolateSOCKSAuth`.
