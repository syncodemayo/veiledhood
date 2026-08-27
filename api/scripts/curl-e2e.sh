#!/usr/bin/env bash
# End-to-end API checks with curl. Uses isolated MongoDB database name.
set -euo pipefail

API_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$API_ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export MONGODB_URI="${MONGODB_URI:-mongodb://127.0.0.1:27017/veiledhood}"
DB_NAME="veiledhood_curl_e2e_$(date +%s)"
export MONGODB_URI="mongodb://127.0.0.1:27017/${DB_NAME}"

export JWT_SECRET="${JWT_SECRET:-veiledhood-curl-e2e-jwt-secret-min-16}"
export PORT="${PORT:-3099}"
export RPC_URL="${RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}"
export VAULT_ADDRESS="${VAULT_ADDRESS:-0x494360d41fe7eB4CB49De08f0f9F5265f180278a}"

# Anvil / Hardhat default accounts
export TEST_WALLET_A_PK="${TEST_WALLET_A_PK:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
export TEST_WALLET_B_PK="${TEST_WALLET_B_PK:-0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d}"
ADDR_A="0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
ADDR_B="0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
# MockUSDC on Veiledhood Sepolia deployment (lowercase for DB consistency)
CUR="0xc32b7682ff35a185c8a5ef881d6f96480988f2f0"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 1
  }
}

need_cmd curl
need_cmd jq
need_cmd node

npm run build --silent

node dist/index.js &
API_PID=$!
cleanup() {
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null; then
    break
  fi
  sleep 0.25
done

BASE="http://127.0.0.1:${PORT}"
echo "== GET /health"
curl -sf "$BASE/health" | jq .

echo "== GET /auth/message"
MSG=$(curl -sf "$BASE/auth/message" | jq -r .message)

echo "== POST /auth/verify (wallet A)"
export TEST_WALLET_PK="$TEST_WALLET_A_PK"
SIG=$(node scripts/sign-login.mjs "$MSG")
TOKEN_A=$(curl -sf "$BASE/auth/verify" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg m "$MSG" --arg s "$SIG" '{message:$m,signature:$s}')" | jq -r .token)

echo "== GET /auth/validate (Bearer)"
curl -sf "$BASE/auth/validate" -H "Authorization: Bearer $TOKEN_A" | jq .

echo "== GET /user/me (no tag yet)"
curl -sf "$BASE/user/me" -H "Authorization: Bearer $TOKEN_A" | jq .

echo "== POST /user/withdraw-signature -> 400 (no tag)"
CODE=$(curl -s -o /tmp/veil_w.json -w "%{http_code}" "$BASE/user/withdraw-signature" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"amount\":\"1\",\"deadline\":$(( $(date +%s) + 400 )),\"currency\":\"$CUR\"}")
[[ "$CODE" == "400" ]] || {
  echo "expected 400, got $CODE body:" >&2
  cat /tmp/veil_w.json >&2
  exit 1
}
jq . /tmp/veil_w.json

TX1="0x$(printf 'a%.0s' {1..63})1"
echo "== POST /deposits (wallet A) tx=$TX1"
curl -sf "$BASE/deposits" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"txHash\":\"$TX1\",\"currency\":\"$CUR\",\"amount\":\"10000000\"}" | jq .

echo "== Seed Mongo: tag for wallet A (bytes32)"
mongosh "$MONGODB_URI" --quiet --eval "
  db.users.updateOne(
    { address: '$ADDR_A' },
    { \\\$set: {
        tag: '0x00000000000000000000000000000000000000000000000000000000000000ab',
        tagRegisteredAt: new Date()
      }
    }
  )
" >/dev/null

echo "== GET /user/me (with tag + balance)"
curl -sf "$BASE/user/me" -H "Authorization: Bearer $TOKEN_A" | jq .

echo "== POST /user/withdraw-signature -> 400 (insufficient balance)"
CODE=$(curl -s -o /tmp/veil_w2.json -w "%{http_code}" "$BASE/user/withdraw-signature" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"amount\":\"20000000\",\"deadline\":$(( $(date +%s) + 400 )),\"currency\":\"$CUR\"}")
[[ "$CODE" == "400" ]] || {
  echo "expected 400, got $CODE" >&2
  cat /tmp/veil_w2.json >&2
  exit 1
}
jq . /tmp/veil_w2.json

WITHDRAW_SIG_OK=0
if node scripts/withdraw-signer-matches.mjs; then
  WITHDRAW_SIG_OK=1
fi

if [[ "$WITHDRAW_SIG_OK" -eq 1 ]]; then
  echo "== POST /user/withdraw-signature -> 200 (signer matches on-chain verifier)"
  DEADLINE=$(( $(date +%s) + 400 ))
  curl -sf "$BASE/user/withdraw-signature" \
    -H "Authorization: Bearer $TOKEN_A" \
    -H "Content-Type: application/json" \
    -d "{\"amount\":\"1000000\",\"deadline\":$DEADLINE,\"currency\":\"$CUR\"}" | jq '{signature: .signature[0:20], amount, deadline, owner, verifyingContract}'
else
  echo "== SKIP withdraw-signature 200 (set SIGNER_PRIVATE_KEY to match vault withdrawVerifier for full check)"
fi

TX_W="0x$(printf 'c%.0s' {1..63})1"
echo "== POST /withdraws (record) -> 201"
curl -sf "$BASE/withdraws" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"txHash\":\"$TX_W\",\"currency\":\"$CUR\",\"amount\":\"1000000\"}" | jq .

echo "== POST /withdraws (duplicate) -> 200"
curl -sf "$BASE/withdraws" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"txHash\":\"$TX_W\",\"currency\":\"$CUR\",\"amount\":\"1000000\"}" | jq .

echo "== GET /user/me after withdraw"
curl -sf "$BASE/user/me" -H "Authorization: Bearer $TOKEN_A" | jq .

echo "== POST /auth/verify (wallet B)"
export TEST_WALLET_PK="$TEST_WALLET_B_PK"
SIG_B=$(node scripts/sign-login.mjs "$MSG")
TOKEN_B=$(curl -sf "$BASE/auth/verify" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg m "$MSG" --arg s "$SIG_B" '{message:$m,signature:$s}')" | jq -r .token)

TX_T="0x$(printf 'd%.0s' {1..63})1"
echo "== POST /transfers A -> B"
curl -sf "$BASE/transfers" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"txHash\":\"$TX_T\",\"currency\":\"$CUR\",\"amount\":\"2000000\",\"to\":\"$ADDR_B\"}" | jq .

echo "== GET /user/me (A and B)"
curl -sf "$BASE/user/me" -H "Authorization: Bearer $TOKEN_A" | jq .
curl -sf "$BASE/user/me" -H "Authorization: Bearer $TOKEN_B" | jq .

echo "== POST /transfers self -> 400"
CODE=$(curl -s -o /tmp/veil_t.json -w "%{http_code}" "$BASE/transfers" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"txHash\":\"0x$(printf 'e%.0s' {1..63})1\",\"currency\":\"$CUR\",\"amount\":\"1\",\"to\":\"$ADDR_A\"}")
[[ "$CODE" == "400" ]] || {
  echo "expected 400, got $CODE" >&2
  cat /tmp/veil_t.json >&2
  exit 1
}

echo "== All curl e2e checks passed (DB=$DB_NAME)"
