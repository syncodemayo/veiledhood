# Merkle fix — DevOps deploy runbook

This document is the operational counterpart to PR `fix/merkle-leaf-and-orphans`.
It is the *only* place that should describe changes to the droplet, the
`.env` files, the running PM2 processes, or the MongoDB databases.

Droplet: `ai-agent-marketplace-nodejs-app` (DO id `491096632`, region fra1,
public IPs `167.71.59.86`, `134.199.189.208`).

PM2 processes: `veiledhood-prod` (id 388), `veiledhood-dev` (id 387).

PM2 lives under nvm; remember to load the path:

```bash
export PATH=/root/.nvm/versions/node/v22.15.0/bin:$PATH
```

## What the PR does

| Area | Change |
|---|---|
| `api/scripts/backfill-orphan-chain.ts` | New migration that backfills `chainId` + `assetKey` on rows where `chainId` is missing **or null** (the prior `backfill-chain-fields.ts` script only handled missing). |
| `api/src/services/transferMerklePayout.ts` | Proof + `adminWithdraw` now use the recipient's **full ledger leaf balance** instead of the per-transfer amount. Adds a "zombie guard": if recipient ledger is already 0 because a sibling transfer swept the leaf first, the row is marked settled with a sentinel hash and skipped on chain. |
| `api/src/index.ts` | Boot-time transfer resume now picks the **correct env per transfer chainId** (Base vs ETH). Wraps indexer + resume in an `INDEXER_DISABLED` gate. Switches the stuck query from `null` equality to `{ $in: [null, undefined] }`. |
| `api/src/routes/user.ts` | Base `/user/withdraw-signature` now filters `UserBalance.findOne` by `chainId`. **Requires migration to run first** or it freezes any legacy user whose row still has `chainId: null`. |
| `api/src/services/depositIndexer.ts` | `applyDepositedLog` now dedupes via `Deposit.create` **first** before bumping `UserBalance`. Previously deposits already recorded via the frontend `POST /eth/deposits` path would be double-counted by the indexer. |
| `api/src/config/env.ts` | New optional `INDEXER_DISABLED` env var. |

## Pre-flight checks

Before touching anything, confirm baseline. Run on the droplet:

```bash
export PATH=/root/.nvm/versions/node/v22.15.0/bin:$PATH
pm2 list | grep veiledhood
cd /var/www/veiledhood-prod/api && node -e '
import("mongoose").then(async m=>{
  const env = (await import("dotenv")).config({path:"../.env"});
  await m.default.connect(process.env.MONGODB_URI);
  const db = m.default.connection.db;
  console.log("orphans userbalances:", await db.collection("userbalances").countDocuments({chainId:{$in:[null]}}));
  console.log("orphans transfers:", await db.collection("transfers").countDocuments({chainId:{$in:[null]}}));
  console.log("stuck transfers:", await db.collection("transfers").countDocuments({adminWithdrawTxHash:{$in:[null,undefined]}}));
  await m.default.disconnect();
});'
```

Expected (as of 2026-05-16 17:00 UTC):
- `userbalances` orphans: 8 (4 nonzero)
- `transfers` orphans: variable
- stuck transfers: 4

Record the numbers before deploying so you can compare after.

## Step 1 — Stop dev clobbering prod's on-chain vault

`veiledhood-dev` is currently configured with the **same on-chain vault
addresses** as prod (Base `0x58a4…De4a`, ETH `0x97B2…E1Bc`). Its deposit
indexer commits Merkle roots to those contracts whenever it sees new
events. Every commit overwrites prod's root and causes the
`Merkle root mismatch after updateMerkleRoot (resume transfer phase)`
errors seen in `/root/.pm2/logs/veiledhood-prod-error-388.log` at
`15:16:21`.

The PR adds an `INDEXER_DISABLED` flag. **Edit `/var/www/veiledhood-dev/.env`
and add at the end of the file:**

```
INDEXER_DISABLED=true
```

Do **not** add this to `/var/www/veiledhood-prod/.env`. Prod must keep
running the indexer.

This is the only `.env` change required for the PR. Both files otherwise
stay as they are.

## Step 2 — Pull the PR onto the droplet

The droplet currently has no `.git` directory in `/var/www/veiledhood-prod`;
deployments appear to be `rsync`/CI-driven. Adapt the commands below to
whatever your existing pipeline does — the only thing that matters is
that the **compiled `dist/`** on both droplets matches the merged PR.

If you build on the droplet:

```bash
export PATH=/root/.nvm/versions/node/v22.15.0/bin:$PATH
# Build dev first
cd /var/www/veiledhood-dev/api
git fetch origin              # or rsync, however you deploy
git checkout develop          # PR merges here
git pull --ff-only
npm install --no-audit --no-fund
npm run build
```

Repeat for prod **only after Step 4 verification on dev passes**:

```bash
cd /var/www/veiledhood-prod/api
git pull --ff-only
npm install --no-audit --no-fund
npm run build
```

(If the dirs aren't git checkouts, substitute your existing deploy
process. The important artifacts under `api/dist/` are listed below.)

Expected files that change in `dist/`:

```
api/dist/config/env.js
api/dist/index.js
api/dist/routes/user.js
api/dist/services/depositIndexer.js
api/dist/services/transferMerklePayout.js
```

Plus a new `api/dist/scripts/backfill-orphan-chain.js` (or you can run
the `.ts` source with `tsx` instead, see Step 3).

## Step 3 — Run the orphan-chain migration (**dev first, then prod**)

The migration is **idempotent**. Re-running it is a no-op once orphans
are 0.

```bash
export PATH=/root/.nvm/versions/node/v22.15.0/bin:$PATH

# Dev
cd /var/www/veiledhood-dev/api
npm run migrate:orphan-chain

# Verify it landed
node -e '
import("mongoose").then(async m=>{
  (await import("dotenv")).config({path:"../.env"});
  await m.default.connect(process.env.MONGODB_URI);
  console.log("orphans:", await m.default.connection.db.collection("userbalances").countDocuments({chainId:{$in:[null]}}));
  await m.default.disconnect();
});'
# expected: orphans: 0
```

Then prod (only after dev is clean):

```bash
cd /var/www/veiledhood-prod/api
npm run migrate:orphan-chain
# same verification command, same expectation
```

If `orphans` is still > 0 after migration, **stop** — do not restart the
prod process. The migration must succeed before Patch C ships, otherwise
the chainId filter in `/user/withdraw-signature` will reject withdrawals
from those legacy users.

## Step 4 — Restart pm2 + watch logs

```bash
export PATH=/root/.nvm/versions/node/v22.15.0/bin:$PATH
pm2 restart veiledhood-dev
pm2 logs veiledhood-dev --lines 200
```

Expected dev log:

```
[veiledhood-api] RPC chainId: 8453
[veiledhood-api] INDEXER_DISABLED=true — skipping deposit indexer + transfer resume (read-only API mode)
veiledhood-api listening on port <dev port>
```

If dev still logs `Deposit indexer started`, the `INDEXER_DISABLED=true`
env line did not land — double check `/var/www/veiledhood-dev/.env`.

Soak dev for 15–30 minutes. Manually exercise:
- deposit on Base (small ETH)
- deposit on ETH mainnet (small ETH)
- transfer between two wallets
- withdraw

Then prod:

```bash
pm2 restart veiledhood-prod
pm2 logs veiledhood-prod --lines 200
```

Expected prod log:

```
[veiledhood-api] RPC chainId: 8453
[veiledhood-api] Deposit indexer started (startup sync + live Deposited listener)
veiledhood-api listening on port 6619
[veiledhood-api] Resuming 4 incomplete transfer(s)…
[veiledhood-api] Transfer 35f2c9e4-71dd-48a8-b1da-95f3bdfef4a1 (chainId=8453) resumed: payout 0x...
[veiledhood-api] Transfer 6926ce0a-f6fb-4249-b7e2-10c2579f4df8 (chainId=8453) resumed: payout 0x00000000...
[veiledhood-api] Transfer 4996cedf-5a02-4dfa-84df-dd07f4715e0a (chainId=8453) resumed: payout 0x00000000...
[veiledhood-api] Transfer 41e37f2f-fa9e-445d-ba21-a41acf563624 (chainId=8453) resumed: payout 0x...
```

Two of the three `0x46a2…→0xc585…` stuck transfers should land on the
zombie sentinel (`0x0000…`) because the first resume sweeps the full
leaf. That is expected and correct — the recipient was credited and paid
out in a single batched `adminWithdraw`.

If you see `Leaf is not in tree` again after restart, **stop and ping
the engineer who shipped the PR** — that means the fix is incomplete and
needs investigation, not a roll-forward.

## Step 5 — Smoke-test prod

From a real wallet, on `app.veiledhood.to`:

1. Connect wallet on **Base**.
2. Make a small native-ETH deposit (e.g. 0.0005 ETH).
3. Wait for the indexer to pick it up (5–15s).
4. Check that the shielded balance on the UI matches.
5. Transfer to a wallet that already has a shielded balance (one of the
   existing recipient addresses works). Confirm the recipient is paid
   out their full ledger balance on-chain.
6. Withdraw remaining shielded balance back to your wallet.

Repeat for **Ethereum mainnet** with a wallet that has a small balance.
ETH deposits flow through `POST /eth/deposits` — confirm the deposit
appears in the UI within a few seconds.

## Rollback

If anything goes wrong, the previous code at `8b2c397` is still on
`origin/main`. Roll back with whatever your deploy pipeline uses, and
restart pm2.

The **DB migration is forward-only and idempotent** — it does not need
to be rolled back. Backfilled rows are correct regardless of which code
version is running.

The **only env change** that needs reverting is removing the
`INDEXER_DISABLED=true` line from `/var/www/veiledhood-dev/.env` if you
revert the code, since older code does not understand that flag.

## What this PR does NOT fix

These are tracked separately:

- **No ETH-chain deposit indexer.** ETH deposits still rely on the
  frontend `POST /eth/deposits` call. If the user's tab closes between
  on-chain confirmation and the API call, the deposit is missing from
  the DB. A follow-up PR will add `startDepositIndexerEth` with its own
  cursor key (`deposited:eth`).
- **Race between concurrent `/transfers` for the same chain.** Two
  users withdrawing simultaneously can still see one of their txs
  revert because the on-chain root moved between proof generation and
  user broadcast. Mitigated short-term by single PM2 instance; needs
  per-chain mutex around the (commit → proof → user-broadcast) window.
- **Dev and prod share on-chain vault addresses.** This PR papers over
  it with `INDEXER_DISABLED=true` on dev. The real fix is to deploy
  separate dev vaults or point dev at testnet.
