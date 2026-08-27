# Private Base↔Eth Bridging — Design Spec

**Date:** 2026-06-18
**Status:** Approved (design), pending implementation plan
**Scope (locked):** Base (8453) ↔ Ethereum (1) only, both directions. No other chains.

## Context

Veiledhood's public roadmap lists "Private bridging (Base ↔ Ethereum)" under shipped v1.0, but
no cross-chain mechanism exists today. Base and Ethereum each run an independent `Veiledhood.sol`
vault with its own off-chain Mongo ledger, on-chain reserves, merkle-root commit, and
admin/self `adminWithdraw` payout. A user's Base shielded balance and Eth shielded balance are
separate silos. The only way to move value between them today is a manual withdraw-on-Base →
re-deposit-on-Eth, which is public and trivially linkable.

This spec defines actual private bridging between the two chains as **net-new feature work**.

## Decisions (from brainstorming, 2026-06-18)

| Decision | Choice | Rationale |
|---|---|---|
| Liquidity model | Self-funding atomic move (per-user) | No standing treasury buffer; user's own funds move per bridge. |
| Latency rail | Fast third-party bridge — **deBridge DLN** | Native Base→Eth withdrawal is ~7 days (Optimism challenge period); deBridge DLN settles in seconds-to-minutes with canonical USDC + ETH on both chains, 0-TVL intent/solver model, clean EVM SDK. |
| Privacy mechanism | Per-user bridge with **fresh backend-controlled escrow addresses** on both legs | Privacy comes from Veiledhood's wrapper, never from the bridge (all of deBridge/Wormhole/LZ/NEAR are transparent). |
| Integration level | **Approach A** — backend-orchestrated, **no `Veiledhood.sol` change** | Existing `adminWithdraw` + `deposit` + merkle machinery suffice. No new Solidity, no re-audit, no redeploy. |
| Assets | **USDC + ETH** | Both shielded vault assets (ETH = `address(0)`). |
| Granularity | **Partial amounts** | Handled natively via off-chain ledger split (below) — no withdraw-full/redeposit dance. |

## Privacy boundary (honest accounting)

- **Hidden:** the user's main wallet never appears in any bridge transaction. Both bridge legs
  use fresh, backend-controlled escrow addresses; the destination balance is credited to a fresh
  shielded address the user controls.
- **Accepted "link":** the two escrow legs (`E_src`, `E_dst`) of the *same* bridge are mutually
  correlatable (same amount, same time window, one bridge message). Neither leg ties to the
  user's identity wallet. Amounts are public on-chain, as in the existing privacy model.
- **Marketing language:** "bridged through fresh shielded addresses" — NOT "fully unlinkable."
  A fully-unlinkable **pooled treasury relay** is a documented v2 upgrade.

## Mechanism

Confirmed against `smart-contracts/contracts/Veiledhood.sol`:
- `adminWithdraw(user, token, balance, proof, deadline, sig)` pays `balance` of `token` **to the
  `user` address committed in the leaf** (`_executeWithdraw`). Funds go wherever the leaf is keyed.
- Leaves are `(user, token, balance)` (`api/src/services/merkleTree.ts`), assigned by the
  off-chain ledger that Veiledhood controls (`UserBalance`).

Because we control leaf assignment, we split off-chain into a fresh escrow leaf rather than
withdrawing the user's own leaf. This handles partial amounts natively and keeps the user's
wallet off the source withdrawal.

### Bridging `X` of balance `B`, Base→Eth (reverse is symmetric)

**Source (Base):**
1. **Off-chain split:** debit user's leaf by `X` (user retains `B−X`); credit a fresh
   backend-controlled escrow address `E_src` with `X`. Recommit Base merkle root.
2. **`adminWithdraw(E_src, token, X, proof)`** → pays `X` to `E_src` (fresh address, not the
   user's wallet). Base reserves −= `X`.

**Bridge:**
3. `E_src` approves (ERC-20 USDC) / sends (ETH) and creates a **deBridge DLN order** →
   fresh destination escrow `E_dst` on Eth. Record the **actual fulfilled amount** `X'`
   (= `X` − deBridge protocol fee − solver spread − dest gas).

**Destination (Eth):**
4. `E_dst` receives `X'`, calls **`deposit(token, X')`** into the Eth vault. Eth reserves += `X'`.
5. **Off-chain:** credit the user's fresh shielded Eth address with `X'`. Recommit Eth root.

The destination credit equals the **actual received `X'`**, never the nominal `X`.

## New components

| File | Purpose |
|---|---|
| `api/src/models/Bridge.ts` | Bridge state record + status + all tx hashes + escrow refs |
| `api/src/routes/bridge.ts` | `POST /bridge/fee-quote`, `POST /bridge`, `GET /bridge/:id` |
| `api/src/services/bridgeOrchestrator.ts` | State machine driver + resume-on-boot |
| `api/src/services/deBridgeClient.ts` | DLN wrapper: quote / createOrder / getStatus / on-chain fulfillment read |
| `api/src/services/bridgeEscrow.ts` | HD-derived fresh escrow addresses + signing |
| `frontend/src/components/dapp/bridge-tab.tsx` | Bridge UI: direction toggle, amount, fee quote, progress |

**Reused as-is:** `api/src/services/veiledhoodAdmin.ts` (`adminWithdraw`/`deposit`/`updateMerkleRoot`),
`api/src/services/merkleTree.ts`, the off-chain ledger split + root-commit services,
`frontend/src/components/dapp/network-chain-toggle.tsx`, `frontend/src/lib/veiledhoodApi.ts`.

**Edited:** `api/src/config/env.ts` (deBridge config, `BRIDGE_ESCROW_SEED`, bridge fee config),
`api/src/index.ts` (mount router + resume on boot).

## State machine

```
created
  → source_split        (off-chain debit user, credit E_src; Base root committed)
  → source_withdrawn    (adminWithdraw E_src leaf on Base confirmed)
  → bridge_submitted    (deBridge DLN order created from E_src)
  → bridge_fulfilled    (on-chain fulfillment to E_dst confirmed; X' known)
  → dest_deposited      (E_dst deposit() into Eth vault confirmed)
  → dest_credited       (off-chain credit user's fresh Eth shielded addr; Eth root committed)
  → complete
```

**Failure at any non-terminal state → refund path:** re-credit the user's source ledger from the
recoverable escrow position (or replenish from `E_src`/`E_dst` funds still held), then mark
`failed` / `refunded`. Resume-on-restart scans non-terminal bridge records on boot and re-drives
them — mirrors the existing `transferMerklePayout` resume pattern.

## Money-safety invariants

1. Credit the destination ledger **only after** the on-chain Eth `deposit()` is confirmed.
2. Validate deBridge order fulfillment via the **on-chain settlement event**, not the API alone.
3. One idempotency key per bridge; state guards prevent double-credit and refund-abuse.
4. Reserve solvency check before each on-chain leg.
5. The destination credit uses the **actual fulfilled amount** `X'`, never the requested `X`.

## Security (per `~/.claude/SECURITY.md`)

- **Escrow keys** HD-derived from `BRIDGE_ESCROW_SEED`, derived on demand, **never logged**, one
  fresh address per bridge. These addresses hold user funds in transit → highest sensitivity.
  Seed stored only in the prod secret store; never in the repo or client.
- **External dependency** (deBridge): pin the SDK version; verify fulfillment on-chain.
- Rate-limit + per-user daily quota on `POST /bridge` (reuse the rate-limit middleware pattern).
- Replay/reentrancy: idempotency key + the contract's existing nullifier guard.
- The refund path is guarded so it cannot be triggered to double-spend.

## Testing

- **Unit:** escrow derivation determinism; mocked deBridge client; orchestrator state transitions;
  partial-split math (`X` + `B−X` = `B`, no rounding loss); fee-quote math.
- **Integration:** full bridge on Base Sepolia ↔ Eth Sepolia, both directions, USDC + ETH.
- **Crash-injection:** kill the process at each non-terminal state → resume drives to `complete`
  or `refunded` correctly, exactly once.
- **Bridge-failure:** simulate deBridge non-fulfillment / timeout → refund re-credits the source
  ledger exactly once; reserves reconcile.
- **Privacy assertion:** scan all bridge on-chain txs for the user's main-wallet address → zero
  occurrences.

## Out of scope (deferred)

- Pooled treasury relay (fully-unlinkable v2).
- Chains other than Base ↔ Eth.
- Contract-level deBridge adapter (Approach B).
- Standing treasury buffer for instant credit independent of bridge latency.

## deBridge DLN spike findings (2026-06-18 — resolves open item #1)

Use the **REST API directly** (no SDK dependency needed). Two hosts:

- **Quote + order creation (one GET):**
  `GET https://dln.debridge.finance/v1.0/dln/order/create-tx`
  Params: `srcChainId`, `srcChainTokenIn`, `srcChainTokenInAmount`, `dstChainId`,
  `dstChainTokenOut`, `dstChainTokenOutAmount` (use `auto`), `dstChainTokenOutRecipient`,
  `srcChainOrderAuthorityAddress`, `dstChainOrderAuthorityAddress`, `senderAddress`,
  `affiliateFeePercent`, `referralCode`.
  Calling **without** recipient/authority addresses returns a **quote-only** response (use for
  `/bridge/fee-quote`). Response JSON: `{ orderId, estimation { srcChainTokenIn { amount },
  dstChainTokenOut { amount }, costDetails[] }, tx { to, data, value } }`. The returned `tx` must
  be submitted on-chain within ~30s or re-fetched.
- **Order status:** `GET https://dln-api.debridge.finance/api/Orders/{orderId}` →
  status string ∈ `Created | Fulfilled | SentUnlock | ClaimedUnlock | OrderCancelled`
  (+ internal states). `Fulfilled` (or later) = funds delivered to the recipient on dest.
- **Order id(s) from a source tx hash:**
  `GET https://dln-api.debridge.finance/api/Transaction/{hash}/orderIds`.
- **Native ETH** is the **zero address** `0x0000000000000000000000000000000000000000` on both legs.
- **Env impact:** add `DEBRIDGE_STATS_API_URL` (default `https://dln-api.debridge.finance/api`)
  alongside the existing `DEBRIDGE_API_URL` (create-tx host) — they are different hosts.
- **Token addresses (mainnet):** USDC Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`,
  USDC Eth `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`; chain ids Base `8453`, Eth `1`.
- **Testnet:** DLN Sepolia create-tx support is **unconfirmed**. Plan 2 tests therefore use
  mocked `fetch` (primary) + a guarded **quote-only** live smoke against mainnet create-tx (no
  funds, no submit). Full on-chain E2E moves to Plan 3 staging with tiny mainnet amounts.

## Follow-ups after the v1 build (2026-06-18)

- **Native-ETH through the route.** Backend leg services support native ETH (zero-address
  token), but `/bridge` `currency` schema requires a `0x…40hex` address and the ledger stores ETH
  under a native key. Wire native ETH end-to-end: accept the native key in the route, map it to
  the zero-address token, and match native ledger rows. Until then the **frontend Bridge tab is
  USDC-only** (it shows a notice for native ETH).
- **Fresh destination shielded address.** v1 credits the user's own address on the destination;
  derive + credit a fresh per-bridge shielded address (credit path already supports any address).
- **Leftover escrow-gas sweep** and **post-withdraw on-chain escrow recovery** are ops procedures.
- **DEVOPS runbook** for `BRIDGE_ENABLED`, `BRIDGE_ESCROW_SEED` (funded admin), deBridge URLs,
  fee/quota — plus the staging E2E (Plan 3b Task 7) before enabling in prod.

## Open items still to resolve

- ~~Whether ETH bridging needs a wrap/unwrap step through deBridge~~ — RESOLVED 2026-06-18 via
  Plan 2 live quote-only smoke: a `0x0`→`0x0` native ETH Base→Eth quote returns a positive dst
  amount, so deBridge settles native ETH end-to-end; our client needs no wrap/unwrap step.
- Per-user bridge quota + minimum bridge amount (dust below deBridge fees is uneconomical) —
  set `BRIDGE_USER_DAILY_QUOTA` (done, default 10) and add a per-asset min in Plan 3.
