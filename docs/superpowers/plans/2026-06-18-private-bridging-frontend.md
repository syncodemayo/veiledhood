# Private Bridging — Plan 4: Frontend Bridge Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Checkbox steps.

**Goal:** A "Bridge" tab in the dApp that quotes and initiates a private Base↔Eth USDC bridge and polls its status, matching the existing tab UX.

**Architecture:** Three additive API-client methods + a self-contained `BridgeTab` component (house style from `transfer-tab.tsx`) + minimal wiring into `home-page-client.tsx` and `tab-toggle.tsx`. Direction is derived from the existing network toggle (`chainMode`): source = active chain, dest = the other. v1 is **USDC-only** in the UI (native-ETH bridging needs a backend route currency-key follow-up — flagged in the spec); when the active asset has no ERC-20 address (native ETH) the tab shows a "USDC only for now" notice.

**Tech Stack:** Next.js, React, framer-motion, viem, Tailwind (existing dApp stack).

**Spec:** `docs/superpowers/specs/2026-06-18-private-base-eth-bridging-design.md`. **Depends on:** Plan 3b routes.

**Validation:** `cd frontend && npm run build` (Next typecheck) is green.

---

## Task 1: API client methods

**Files:** Modify `frontend/src/lib/veiledhoodApi.ts` (append).

```typescript
// --- Private bridging ---
export interface BridgeFeeQuote {
  sourceChainId: number;
  destChainId: number;
  currency: string;
  amount: string;
  deBridgeOut: string;
  veiledhoodFee: string;
  recipientReceives: string;
}

export interface BridgeStatusResponse {
  bridgeId: string;
  status: string;
  amountRequested: string;
  amountReceived?: string;
  sourceChainId: number;
  destChainId: number;
  currency: string;
  error?: string;
  createdAt: string;
}

interface BridgeRequestBody {
  sourceChainId: number;
  destChainId: number;
  currency: string;
  amount: string;
}

export async function apiBridgeFeeQuote(
  token: string,
  body: BridgeRequestBody
): Promise<BridgeFeeQuote> {
  const res = await fetch(`${apiBase()}/bridge/fee-quote`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Quote failed (${res.status})`);
  return res.json();
}

export async function apiBridgeCreate(
  token: string,
  body: BridgeRequestBody
): Promise<{ bridgeId: string; status: string }> {
  const res = await fetch(`${apiBase()}/bridge`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Bridge failed (${res.status})`);
  return res.json();
}

export async function apiBridgeStatus(
  token: string,
  bridgeId: string
): Promise<BridgeStatusResponse> {
  const res = await fetch(`${apiBase()}/bridge/${bridgeId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Status failed (${res.status})`);
  return res.json();
}
```

- [ ] Append the block; `cd frontend && npm run build` green; commit `feat(bridge-ui): API client methods`.

---

## Task 2: `BridgeTab` component

**Files:** Create `frontend/src/components/dapp/bridge-tab.tsx` (see implementation in the build step — direction banner from source/dest labels, amount input, "Get quote" → shows `recipientReceives`, "Bridge" → create + poll `apiBridgeStatus` every 4s until a terminal status, inline progress). USDC-only guard when `tokenAddress` is null.

- [ ] Build per house style (mirror `transfer-tab.tsx`); `npm run build` green; commit `feat(bridge-ui): BridgeTab component`.

---

## Task 3: Wire into the dApp

**Files:** Modify `frontend/src/components/dapp/tab-toggle.tsx` (add `bridge` to `DappTab` + a tab entry with an icon), `frontend/src/components/home-page-client.tsx` (add `"bridge"` to `ActiveTab`; add a render branch passing `token`, `sourceChainId`/`destChainId` from `chainMode`, `tokenAddress={erc20Addr}`, `symbol`, `decimals`, `shieldedBalanceRaw`).

- [ ] Wire; `npm run build` green; commit `feat(bridge-ui): mount Bridge tab in dApp`.

---

## Self-Review
Covers fee-quote + create + status polling (spec routes) and the Base↔Eth direction from the existing toggle. USDC-only is an explicit, surfaced v1 limit (native-ETH route follow-up flagged in spec). No backend changes here.
