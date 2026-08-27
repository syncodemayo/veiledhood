# Private Prompts + Tor — DevOps deploy runbook

Operational counterpart to PR `feat/private-prompts-tor`. The *only* place
that describes droplet changes, `.env` updates, the systemd Tor service,
the new Redis dependency, and the PM2 restart sequence.

Droplet: `ai-agent-marketplace-nodejs-app` (DO id `491096632`, region fra1,
public IPs `167.71.59.86`, `134.199.189.208`).

PM2 processes: `veiledhood-prod` (id 388), `veiledhood-dev` (id 387).

PM2 lives under nvm; load path:

```bash
export PATH=/root/.nvm/versions/node/v22.15.0/bin:$PATH
```

## What the PR does

| Area | Change |
|---|---|
| `api/package.json` | New deps: `@solrouter/sdk`, `fetch-socks`, `undici@^8.3.0`, `ioredis@^5`. **`undici@^8.3.0` is intentional** — Node's bundled undici v7 is incompatible with `fetch-socks` dispatchers (see `docs/phase-1/GATE-A-empirical-tor-probe.md`). |
| `api/src/config/env.ts` | New env block for SolRouter, Tor, rate-limit, Redis. All have safe defaults; only `SOLROUTER_API_KEY` is mandatory for the feature. |
| `api/src/services/solRouterClient.ts` | New. SolRouter SDK wrapper that scopes a `globalThis.fetch` monkey-patch to the SolRouter base URL, routes through SOCKS5 Tor with per-user stream isolation (SOCKS auth = SHA-256 of wallet address), and retries on transient network failures via fresh circuits. |
| `api/src/middleware/rateLimit.ts` | New. Redis-backed token-bucket per JWT subject: 5/min, 50/day defaults. Fails open on Redis outage. |
| `api/src/routes/ai.ts` | New. `GET /ai/config` exposes model whitelist + quota. `POST /ai/chat` (auth + rate-limited) calls SolRouter privately. NEVER logs prompt or response text — only metadata. |
| `api/src/routes/aiHealth.ts` | New. `GET /health/ai` returns green only if Redis, Tor SOCKS port, and SolRouter API key are all healthy. |
| `api/src/index.ts` | Mounts the two new routers. No other changes. |
| `frontend/src/components/dapp/private-chat-tab.tsx` | New. The chat UI itself (model picker, message list, prompt input, quota footer). |
| `frontend/src/components/dapp/tab-toggle.tsx` | Extended from 2-tab to 3-tab (`vault | transfer | chat`). |
| `frontend/src/components/home-page-client.tsx` | Renders `PrivateChatTab` when `activeTab === "chat"`. |
| `frontend/src/lib/veiledhoodApi.ts` | New `apiAiConfig()` + `apiAiChat()` helpers. |

## Pre-flight checks

Baseline on the droplet:

```bash
export PATH=/root/.nvm/versions/node/v22.15.0/bin:$PATH
pm2 list | grep veiledhood
node --version    # expect v22.15.0; the new fetch-socks + undici@^8 stack also works on v24
which tor || echo "tor not installed yet"
systemctl status tor 2>/dev/null || true
systemctl status redis-server 2>/dev/null || true
```

Expected before this PR is deployed:
- `tor`: not installed (this PR introduces it)
- `redis-server` or equivalent: not installed (also introduced here)

## Step 1 — install + configure Tor (DO droplet)

```bash
# Standard Tor client. Do NOT install tor-arm, tor-instances, or relay packages.
apt update
apt install -y tor

# Use a dedicated config so we don't clobber the distro default.
cat > /etc/tor/veiledhood.conf <<'EOF'
SocksPort 127.0.0.1:9050 IsolateSOCKSAuth KeepAliveIsolateSOCKSAuth
DataDirectory /var/lib/tor-veiledhood
RunAsDaemon 0
Log notice syslog
EOF

mkdir -p /var/lib/tor-veiledhood
chown debian-tor:debian-tor /var/lib/tor-veiledhood
chmod 700 /var/lib/tor-veiledhood

# systemd unit so PM2 isn't responsible for Tor.
cat > /etc/systemd/system/tor-veiledhood.service <<'EOF'
[Unit]
Description=Tor SOCKS5 client for Veiledhood API outbound
After=network.target

[Service]
Type=simple
User=debian-tor
Group=debian-tor
ExecStart=/usr/bin/tor -f /etc/tor/veiledhood.conf
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now tor-veiledhood
systemctl status tor-veiledhood --no-pager
```

Verify:

```bash
ss -tlnp | grep 9050
curl --socks5-hostname 127.0.0.1:9050 https://check.torproject.org/api/ip
# Expect: {"IsTor":true,"IP":"<some Tor exit IP>"}
```

If `IsTor:true` doesn't return, **do not proceed**. Investigate exit IP with `journalctl -u tor-veiledhood -n 200`.

Disable the default `tor` service if `apt install` enabled it — we don't want two daemons:

```bash
systemctl status tor || true
systemctl disable --now tor 2>/dev/null || true
```

## Step 2 — install Redis (DO droplet)

For Phase 1 a local Redis on the droplet is fine. Phase 3 may move this to DO Managed Redis if multi-droplet HA becomes a need.

```bash
apt install -y redis-server
sed -i 's/^bind .*/bind 127.0.0.1/' /etc/redis/redis.conf
sed -i 's/^# requirepass .*/requirepass CHANGE_ME_RANDOM_STRING/' /etc/redis/redis.conf
systemctl enable --now redis-server
systemctl status redis-server --no-pager
redis-cli -a CHANGE_ME_RANDOM_STRING ping  # expect PONG
```

Note the password — it goes into the `REDIS_URL` env value below.

## Step 3 — env vars

Add to `/var/www/veiledhood-prod/.env` (and `/var/www/veiledhood-dev/.env`):

```
SOLROUTER_API_KEY=sk_solrouter_XXXXXXXXXXXXXXXXXXXX
AI_MODEL_WHITELIST=gpt-oss-20b,gpt-4o-mini
TOR_ENABLED=true
TOR_SOCKS_HOST=127.0.0.1
TOR_SOCKS_PORT=9050
AI_RATE_LIMIT_PER_USER_PER_DAY=50
AI_RATE_LIMIT_PER_USER_PER_MIN=5
AI_RATE_LIMIT_DISABLED=false
REDIS_URL=redis://:CHANGE_ME_RANDOM_STRING@127.0.0.1:6379
```

The `SOLROUTER_API_KEY` is provisioned via 1Password (or the team secret store).
**Do not paste it into chat, terminals, or commit history.** Pull it directly
into the .env on the droplet.

## Step 4 — deploy code

```bash
export PATH=/root/.nvm/versions/node/v22.15.0/bin:$PATH
cd /var/www/veiledhood-prod
git fetch origin
git checkout develop
git pull --ff-only

cd api
npm ci
npm run build

cd ../frontend
npm ci
npm run build

pm2 restart veiledhood-prod
pm2 logs veiledhood-prod --lines 50 --nostream
```

## Step 5 — smoke

```bash
# Backend health
curl -s http://127.0.0.1:3000/health/ai | jq
# Expect every check `ok: true`. status="ok".

# JWT-authenticated chat (replace JWT and URL host as appropriate).
JWT=...; curl -s -X POST https://api.veiledhood.to/ai/chat \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Say pong","model":"gpt-oss-20b","maxTokens":8}' | jq

# Confirm SolRouter dashboard shows traffic from a Tor exit IP, not the droplet IP.
```

## Rollback

1. Revert the merge commit on `develop` (or branch off and merge a revert PR).
2. Pull, `npm ci && npm run build`, `pm2 restart veiledhood-prod`.
3. Leave Tor + Redis running — both are passive after the route is gone.
4. If reverting *and* removing infra: `systemctl disable --now tor-veiledhood redis-server`.

## Monitoring touch-points

- **Tor health:** `systemctl is-active tor-veiledhood` should always be `active`. Alert on transition.
- **Redis health:** `redis-cli ping` should return `PONG`. Alert on `LOADING` for > 10s.
- **/health/ai:** add to uptime checker. Page on > 5 min unhealthy.
- **SolRouter treasury:** monitor balance via `GET /api/v1/balance` from a periodic job. Top up when < $50 USDC. Sustainable usage will draw ~$0.05–0.10 per active beta user per day at the current model whitelist.
- **Rate-limit hits:** count of 429s per hour from the API logs. Spike → either an abusive user or under-provisioned quota.

## Cost expectations

At 50 messages/day × 5 cents avg = **$2.50/day per heavy user**. Cohort of 50
heavy users ≈ $125/day, $3.7k/mo. Lighter usage (5–10 msgs/day average) is
roughly 10× cheaper. Re-evaluate the quota dial monthly.
