# Private Bridging — Plan 1: Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four dependency-free foundations of private Base↔Eth bridging — the `Bridge` state model, env config, deterministic escrow-key derivation, and the off-chain ledger-split helper — each fully unit/integration tested, with no money movement and no external bridge calls.

**Architecture:** Pure additive backend work in `api/`. No changes to `Veiledhood.sol`, no changes to existing routes. Mirrors established patterns: Mongoose models like `UserBalance`/`Transfer`, zod env schema in `config/env.ts`, `node:test` + `mongodb-memory-server` for tests. These four units are consumed later by Plan 3's orchestrator.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Mongoose, ethers v6 (`HDNodeWallet`), zod, `node:test` runner (`tsx --test`), `mongodb-memory-server`.

**Spec:** `docs/superpowers/specs/2026-06-18-private-base-eth-bridging-design.md`

---

## File Structure

| File | Responsibility | Created/Modified |
|---|---|---|
| `api/src/models/Bridge.ts` | Bridge state record + status enum + indexes | Create |
| `api/src/config/env.ts` | New bridge env vars (escrow seed, deBridge, fee, quota, enable flag) | Modify |
| `api/src/services/bridgeEscrow.ts` | Deterministic HD derivation of fresh escrow wallets; never logs keys | Create |
| `api/src/services/bridgeLedgerSplit.ts` | Pure split math + DB applier (debit user leaf, credit escrow leaf) | Create |
| `api/src/services/bridgeEscrow.test.ts` | Tests for escrow derivation | Create |
| `api/src/services/bridgeLedgerSplit.test.ts` | Tests for split math + DB applier | Create |
| `api/src/models/Bridge.test.ts` | Tests for the Bridge model schema | Create |

**Run all tests:** `cd api && npm test`
**Run one file:** `cd api && npx tsx --test src/services/bridgeEscrow.test.ts`

---

## Task 1: `Bridge` state model

The single source of truth for an in-flight bridge. Status drives the Plan 3 state machine and resume-on-boot. `bridgeId` is the server-generated idempotency anchor; both escrow addresses, the deBridge order id, every leg's tx hash, and the actual fulfilled amount are recorded here.

**Files:**
- Create: `api/src/models/Bridge.ts`
- Test: `api/src/models/Bridge.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// api/src/models/Bridge.test.ts
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Bridge, BRIDGE_STATUSES } from "./Bridge.js";

let mem: MongoMemoryServer;

before(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri());
});

after(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

beforeEach(async () => {
  await Bridge.deleteMany({});
});

function validDoc() {
  return {
    bridgeId: "brg_01HZ000000000000000000000",
    userAddress: "0x1111111111111111111111111111111111111111",
    sourceChainId: 8453,
    destChainId: 1,
    currency: "USDC",
    amountRequested: "1000000",
    status: "created" as const,
  };
}

test("persists a valid bridge with defaults", async () => {
  const doc = await Bridge.create(validDoc());
  assert.equal(doc.status, "created");
  assert.equal(doc.amountReceived, undefined);
  assert.ok(doc.createdAt instanceof Date);
});

test("enforces unique bridgeId", async () => {
  await Bridge.create(validDoc());
  await assert.rejects(() => Bridge.create(validDoc()), /duplicate key/i);
});

test("rejects an out-of-enum status", async () => {
  await assert.rejects(
    () => Bridge.create({ ...validDoc(), status: "teleported" as never }),
    /validation failed/i
  );
});

test("status enum constant matches the schema", () => {
  assert.ok(BRIDGE_STATUSES.includes("complete"));
  assert.ok(BRIDGE_STATUSES.includes("refunded"));
  assert.equal(BRIDGE_STATUSES[0], "created");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx tsx --test src/models/Bridge.test.ts`
Expected: FAIL — `Cannot find module './Bridge.js'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// api/src/models/Bridge.ts
import mongoose, { Schema } from "mongoose";

/** State-machine order matters: index 0 is the initial state. */
export const BRIDGE_STATUSES = [
  "created",
  "source_split",
  "source_withdrawn",
  "bridge_submitted",
  "bridge_fulfilled",
  "dest_deposited",
  "dest_credited",
  "complete",
  "failed",
  "refunded",
] as const;

export type BridgeStatus = (typeof BRIDGE_STATUSES)[number];

export interface IBridge {
  /** Server-generated id; idempotency anchor for the whole bridge. */
  bridgeId: string;
  /** The user whose shielded balance is moving (lowercased). */
  userAddress: string;
  sourceChainId: number;
  destChainId: number;
  /** Ledger currency, e.g. "USDC" or the native key. */
  currency: string;
  /** Requested amount to bridge, base units, decimal string. */
  amountRequested: string;
  /** Actual amount that landed on the destination after bridge fees. */
  amountReceived?: string;
  /** Fresh escrow address that receives the source adminWithdraw + sends the bridge. */
  sourceEscrowAddress?: string;
  /** Fresh escrow address that receives the bridge + deposits on the destination. */
  destEscrowAddress?: string;
  /** Fresh shielded address credited on the destination ledger. */
  destShieldedAddress?: string;
  /** deBridge DLN order id, once created. */
  deBridgeOrderId?: string;
  status: BridgeStatus;
  // Per-leg tx hashes (populated as the state machine advances).
  sourceRootBeforeTxHash?: string;
  sourceWithdrawTxHash?: string;
  sourceRootAfterTxHash?: string;
  bridgeTxHash?: string;
  destDepositTxHash?: string;
  destRootAfterTxHash?: string;
  error?: string;
  createdAt: Date;
}

const HASH = { type: String, lowercase: true, match: /^0x[a-f0-9]{64}$/, sparse: true };
const ADDR = { type: String, lowercase: true, trim: true, match: /^0x[a-f0-9]{40}$/ };

const bridgeSchema = new Schema<IBridge>(
  {
    bridgeId: { type: String, required: true, unique: true, trim: true, minlength: 8, maxlength: 64 },
    userAddress: { ...ADDR, required: true },
    sourceChainId: { type: Number, required: true, min: 1 },
    destChainId: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, trim: true, minlength: 1 },
    amountRequested: { type: String, required: true, match: /^\d+$/ },
    amountReceived: { type: String, match: /^\d+$/, sparse: true },
    sourceEscrowAddress: { ...ADDR, sparse: true },
    destEscrowAddress: { ...ADDR, sparse: true },
    destShieldedAddress: { ...ADDR, sparse: true },
    deBridgeOrderId: { type: String, trim: true, sparse: true },
    status: { type: String, required: true, enum: BRIDGE_STATUSES, default: "created" },
    sourceRootBeforeTxHash: HASH,
    sourceWithdrawTxHash: HASH,
    sourceRootAfterTxHash: HASH,
    bridgeTxHash: HASH,
    destDepositTxHash: HASH,
    destRootAfterTxHash: HASH,
    error: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

// Resume-on-boot scans non-terminal statuses; user activity lists by user.
bridgeSchema.index({ status: 1, createdAt: 1 });
bridgeSchema.index({ userAddress: 1, createdAt: -1 });

export const Bridge =
  mongoose.models.Bridge ?? mongoose.model<IBridge>("Bridge", bridgeSchema);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx tsx --test src/models/Bridge.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/src/models/Bridge.ts api/src/models/Bridge.test.ts
git commit -m "feat(bridge): Bridge state model + status enum"
```

---

## Task 2: Bridge env config

Add the bridge knobs to the existing zod env schema. All optional/defaulted so non-bridge deploys still boot; Plan 3 asserts the required ones at call time (same pattern as `assertPayoutEnv`). `BRIDGE_ESCROW_SEED` is the BIP-39 mnemonic from which escrow wallets derive — it is a secret and must never be logged.

**Files:**
- Modify: `api/src/config/env.ts`
- Test: `api/src/config/env.bridge.test.ts` (Create)

- [ ] **Step 1: Read the current env schema to find the insertion point**

Run: `cd api && grep -n "WITHDRAW_DEADLINE_MAX_SEC\|z.object\|export type Env\|export function loadEnv" src/config/env.ts`
Expected: prints the line numbers of the zod schema object, the `Env` type export, and `loadEnv`. Insert the new fields inside the same `z.object({ ... })` block, next to `WITHDRAW_DEADLINE_MAX_SEC`.

- [ ] **Step 2: Write the failing test**

```typescript
// api/src/config/env.bridge.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
// Re-declare just the bridge sub-schema shape we expect loadEnv to include,
// then assert the real schema parses representative values. We import the
// exported BRIDGE_ENV_SHAPE to avoid duplicating the schema.
import { BRIDGE_ENV_SHAPE } from "./env.js";

test("bridge env shape parses a full valid config", () => {
  const schema = z.object(BRIDGE_ENV_SHAPE);
  const parsed = schema.parse({
    BRIDGE_ENABLED: "true",
    BRIDGE_ESCROW_SEED:
      "test test test test test test test test test test test junk",
    DEBRIDGE_API_URL: "https://dln.debridge.finance/v1.0",
    DEBRIDGE_REFERRAL_CODE: "0",
    BRIDGE_FEE_BPS: "25",
    BRIDGE_USER_DAILY_QUOTA: "5",
  });
  assert.equal(parsed.BRIDGE_ENABLED, true);
  assert.equal(parsed.BRIDGE_FEE_BPS, 25);
  assert.equal(parsed.BRIDGE_USER_DAILY_QUOTA, 5);
});

test("bridge env shape applies safe defaults when omitted", () => {
  const schema = z.object(BRIDGE_ENV_SHAPE);
  const parsed = schema.parse({});
  assert.equal(parsed.BRIDGE_ENABLED, false);
  assert.equal(parsed.BRIDGE_FEE_BPS, 0);
  assert.equal(parsed.DEBRIDGE_API_URL, "https://dln.debridge.finance/v1.0");
  assert.equal(parsed.BRIDGE_ESCROW_SEED, undefined);
});

test("bridge fee bps is bounded to <= 10000", () => {
  const schema = z.object(BRIDGE_ENV_SHAPE);
  assert.throws(() => schema.parse({ BRIDGE_FEE_BPS: "10001" }), /BRIDGE_FEE_BPS/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && npx tsx --test src/config/env.bridge.test.ts`
Expected: FAIL — `BRIDGE_ENV_SHAPE` is not exported from `./env.js`.

- [ ] **Step 4: Add the bridge fields to `env.ts`**

Add this exported shape near the top of `api/src/config/env.ts` (after the existing imports, before the main schema), then spread it into the existing `z.object({ ... })`:

```typescript
// --- Bridge (private Base<->Eth bridging) ---
// Exported so it can be unit-tested in isolation. Spread into the main schema.
export const BRIDGE_ENV_SHAPE = {
  /** Master switch; when false the /bridge routes reject. */
  BRIDGE_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** BIP-39 mnemonic for deriving fresh escrow wallets. SECRET — never log. */
  BRIDGE_ESCROW_SEED: z.string().min(1).optional(),
  /** deBridge DLN API base (overridable for staging/testnet). */
  DEBRIDGE_API_URL: z
    .string()
    .url()
    .default("https://dln.debridge.finance/v1.0"),
  /** Optional deBridge referral/affiliate code. */
  DEBRIDGE_REFERRAL_CODE: z.string().optional(),
  /** Veiledhood's own bridge fee in basis points (0..10000). */
  BRIDGE_FEE_BPS: z.coerce.number().int().min(0).max(10000).default(0),
  /** Max bridges per user per day. */
  BRIDGE_USER_DAILY_QUOTA: z.coerce.number().int().min(1).default(10),
} as const;
```

Then, inside the existing `z.object({ ... })` passed to the schema, add the spread (keep all existing fields):

```typescript
  // ...existing fields...
  WITHDRAW_DEADLINE_MAX_SEC: z.coerce.number().int().positive().default(900),
  ...BRIDGE_ENV_SHAPE,
```

(If the existing schema is built as `z.object({...})`, change it to `z.object({ ...existingFields, ...BRIDGE_ENV_SHAPE })`. The `Env` type derived via `z.infer` picks up the new fields automatically.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx tsx --test src/config/env.bridge.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 6: Verify the whole app still type-checks**

Run: `cd api && npm run build`
Expected: `tsc` exits 0, no errors.

- [ ] **Step 7: Document the new vars in `.env.example`**

Append to `api/.env.example`:

```
# --- Private bridging (Base <-> Eth) ---
BRIDGE_ENABLED=false
# BIP-39 mnemonic for escrow wallets — SECRET, set only in the prod secret store
BRIDGE_ESCROW_SEED=
DEBRIDGE_API_URL=https://dln.debridge.finance/v1.0
DEBRIDGE_REFERRAL_CODE=
BRIDGE_FEE_BPS=0
BRIDGE_USER_DAILY_QUOTA=10
```

- [ ] **Step 8: Commit**

```bash
git add api/src/config/env.ts api/src/config/env.bridge.test.ts api/.env.example
git commit -m "feat(bridge): env config for bridging (escrow seed, deBridge, fee, quota)"
```

---

## Task 3: Escrow key derivation

Derive a fresh, deterministic escrow wallet per bridge leg from `BRIDGE_ESCROW_SEED`. Determinism is what lets resume-on-boot re-derive the same address after a crash. Uses a dedicated BIP-44 account branch (`account 7'`) so these keys never collide with any other derived keys. The raw private key is never returned as a string and never logged — callers get an `ethers.HDNodeWallet` they connect to a provider.

**Files:**
- Create: `api/src/services/bridgeEscrow.ts`
- Test: `api/src/services/bridgeEscrow.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// api/src/services/bridgeEscrow.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  deriveEscrowWallet,
  sourceEscrowIndex,
  destEscrowIndex,
} from "./bridgeEscrow.js";

const SEED = "test test test test test test test test test test test junk";

test("derivation is deterministic for the same seed + index", () => {
  const a = deriveEscrowWallet(SEED, 0);
  const b = deriveEscrowWallet(SEED, 0);
  assert.equal(a.address, b.address);
  assert.ok(ethers.isAddress(a.address));
});

test("different indices yield different addresses", () => {
  const a = deriveEscrowWallet(SEED, 0);
  const b = deriveEscrowWallet(SEED, 1);
  assert.notEqual(a.address, b.address);
});

test("source and dest legs of the same bridge get distinct indices", () => {
  const n = 4;
  assert.notEqual(sourceEscrowIndex(n), destEscrowIndex(n));
  // Distinct across bridges too.
  assert.notEqual(sourceEscrowIndex(4), sourceEscrowIndex(5));
});

test("source/dest derive to distinct addresses for one bridge", () => {
  const n = 9;
  const src = deriveEscrowWallet(SEED, sourceEscrowIndex(n));
  const dst = deriveEscrowWallet(SEED, destEscrowIndex(n));
  assert.notEqual(src.address, dst.address);
});

test("throws on empty seed", () => {
  assert.throws(() => deriveEscrowWallet("", 0), /BRIDGE_ESCROW_SEED/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx tsx --test src/services/bridgeEscrow.test.ts`
Expected: FAIL — `Cannot find module './bridgeEscrow.js'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// api/src/services/bridgeEscrow.ts
import { ethers } from "ethers";

/**
 * Dedicated BIP-44 account branch for bridge escrow keys, isolated from any
 * other derivation the system might do. m / 44' / 60' / 7' / 0 / <index>.
 */
const ESCROW_PATH_PREFIX = "m/44'/60'/7'/0";

/**
 * Each bridge `n` (a monotonic integer) gets two leaf indices so the source
 * and destination escrow addresses differ: 2n (source) and 2n+1 (destination).
 */
export function sourceEscrowIndex(bridgeNonce: number): number {
  return bridgeNonce * 2;
}
export function destEscrowIndex(bridgeNonce: number): number {
  return bridgeNonce * 2 + 1;
}

/**
 * Derive a fresh escrow wallet. Deterministic in (seed, index) so resume can
 * re-derive after a crash. The returned wallet holds the key in memory only;
 * NEVER log `wallet.privateKey`.
 */
export function deriveEscrowWallet(seed: string, index: number): ethers.HDNodeWallet {
  if (!seed?.trim()) {
    throw new Error("BRIDGE_ESCROW_SEED is not configured");
  }
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`escrow index must be a non-negative integer, got ${index}`);
  }
  return ethers.HDNodeWallet.fromPhrase(
    seed.trim(),
    "",
    `${ESCROW_PATH_PREFIX}/${index}`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx tsx --test src/services/bridgeEscrow.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/bridgeEscrow.ts api/src/services/bridgeEscrow.test.ts
git commit -m "feat(bridge): deterministic escrow key derivation (HD, isolated branch)"
```

---

## Task 4: Off-chain ledger split

The mechanism that makes partial bridging clean: move `amount` out of the user's leaf and into a fresh escrow leaf, off-chain, conserving the total. Split into a pure math function (trivially testable) plus a thin DB applier that mutates `UserBalance` rows the same way `recordTransfer` does. No merkle/root work here — that stays in Plan 3, which calls `commitMerkleRootFromDb` after this.

**Files:**
- Create: `api/src/services/bridgeLedgerSplit.ts`
- Test: `api/src/services/bridgeLedgerSplit.test.ts`

- [ ] **Step 1: Write the failing test (pure math first)**

```typescript
// api/src/services/bridgeLedgerSplit.test.ts
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { computeSplit, applyLedgerSplit } from "./bridgeLedgerSplit.js";
import { UserBalance } from "../models/UserBalance.js";

test("computeSplit conserves the total", () => {
  const { userRemaining, escrowAmount } = computeSplit(1000n, 300n);
  assert.equal(userRemaining, 700n);
  assert.equal(escrowAmount, 300n);
  assert.equal(userRemaining + escrowAmount, 1000n);
});

test("computeSplit allows bridging the full balance", () => {
  const { userRemaining, escrowAmount } = computeSplit(1000n, 1000n);
  assert.equal(userRemaining, 0n);
  assert.equal(escrowAmount, 1000n);
});

test("computeSplit rejects non-positive amount", () => {
  assert.throws(() => computeSplit(1000n, 0n), /amount must be positive/);
});

test("computeSplit rejects amount exceeding balance", () => {
  assert.throws(() => computeSplit(1000n, 1001n), /exceeds balance/);
});

// --- DB applier ---
let mem: MongoMemoryServer;
before(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri());
});
after(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await UserBalance.deleteMany({});
});

test("applyLedgerSplit debits user and credits escrow", async () => {
  const user = "0x1111111111111111111111111111111111111111";
  const escrow = "0x2222222222222222222222222222222222222222";
  await UserBalance.create({
    address: user,
    chainId: 8453,
    assetKey: "8453:usdc",
    currency: "USDC",
    totalAmount: "1000000",
  });

  await applyLedgerSplit({
    userAddress: user,
    escrowAddress: escrow,
    chainId: 8453,
    currency: "USDC",
    amount: 400000n,
  });

  const u = await UserBalance.findOne({ address: user, chainId: 8453 }).lean();
  const e = await UserBalance.findOne({ address: escrow, chainId: 8453 }).lean();
  assert.equal(u?.totalAmount, "600000");
  assert.equal(e?.totalAmount, "400000");
});

test("applyLedgerSplit throws when the user has insufficient balance", async () => {
  const user = "0x3333333333333333333333333333333333333333";
  await UserBalance.create({
    address: user,
    chainId: 8453,
    assetKey: "8453:usdc",
    currency: "USDC",
    totalAmount: "100",
  });
  await assert.rejects(
    () =>
      applyLedgerSplit({
        userAddress: user,
        escrowAddress: "0x4444444444444444444444444444444444444444",
        chainId: 8453,
        currency: "USDC",
        amount: 500n,
      }),
    /exceeds balance/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx tsx --test src/services/bridgeLedgerSplit.test.ts`
Expected: FAIL — `Cannot find module './bridgeLedgerSplit.js'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// api/src/services/bridgeLedgerSplit.ts
import { UserBalance } from "../models/UserBalance.js";
import {
  ledgerCurrencyMatchKeys,
  normalizeLedgerCurrency,
} from "../util/ledgerCurrency.js";
import { buildAssetKey } from "../util/chainLedger.js";

export function computeSplit(
  currentBalance: bigint,
  amount: bigint
): { userRemaining: bigint; escrowAmount: bigint } {
  if (amount <= 0n) throw new Error("amount must be positive");
  if (amount > currentBalance) {
    throw new Error(`amount ${amount} exceeds balance ${currentBalance}`);
  }
  return { userRemaining: currentBalance - amount, escrowAmount: amount };
}

/**
 * Debit `amount` from the user's ledger leaf and credit a fresh escrow leaf,
 * off-chain, on `chainId`. Conserves the total. Does NOT touch the Merkle root
 * — the caller (Plan 3 orchestrator) commits roots around this.
 */
export async function applyLedgerSplit(params: {
  userAddress: string;
  escrowAddress: string;
  chainId: number;
  currency: string;
  amount: bigint;
}): Promise<void> {
  const { userAddress, escrowAddress, chainId, currency, amount } = params;
  const cur = normalizeLedgerCurrency(currency);
  const keys = ledgerCurrencyMatchKeys(currency);
  const assetKey = buildAssetKey(chainId, cur);

  const userRow = await UserBalance.findOne({
    address: userAddress,
    chainId,
    currency: { $in: keys },
  }).lean<{ totalAmount?: string; currency?: string } | null>();

  const current = BigInt(userRow?.totalAmount ?? "0");
  const { userRemaining, escrowAmount } = computeSplit(current, amount);
  const recvKey = userRow?.currency ?? cur;

  await UserBalance.findOneAndUpdate(
    { address: userAddress, chainId, assetKey },
    {
      $set: {
        address: userAddress,
        chainId,
        assetKey,
        currency: recvKey,
        totalAmount: userRemaining.toString(),
      },
    },
    { upsert: true }
  );

  await UserBalance.findOneAndUpdate(
    { address: escrowAddress, chainId, assetKey },
    {
      $set: {
        address: escrowAddress,
        chainId,
        assetKey,
        currency: recvKey,
        totalAmount: escrowAmount.toString(),
      },
    },
    { upsert: true }
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx tsx --test src/services/bridgeLedgerSplit.test.ts`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Run the whole suite + build**

Run: `cd api && npm test && npm run build`
Expected: all tests pass; `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/services/bridgeLedgerSplit.ts api/src/services/bridgeLedgerSplit.test.ts
git commit -m "feat(bridge): off-chain ledger split (pure math + DB applier)"
```

---

## Self-Review

**Spec coverage (Plan 1 slice):**
- Bridge state record + status → Task 1 ✓ (full `BRIDGE_STATUSES` matches spec state machine)
- `BRIDGE_ESCROW_SEED`, deBridge config, fee, quota → Task 2 ✓
- HD-derived fresh escrow addresses, deterministic, key never returned-as-string/logged → Task 3 ✓
- Partial bridging via off-chain split, total conserved → Task 4 ✓
- (Deferred to later plans, intentionally: orchestrator/state machine, deBridge client, routes, resume, frontend, on-chain legs.)

**Placeholder scan:** none — every step has runnable code/commands and expected output.

**Type consistency:** `BridgeStatus`/`BRIDGE_STATUSES` shared from Task 1; `BRIDGE_ENV_SHAPE` reused by the Task 2 test; `computeSplit`/`applyLedgerSplit` names consistent across Task 4 test and impl; `deriveEscrowWallet`/`sourceEscrowIndex`/`destEscrowIndex` consistent across Task 3.

**Note for Plan 3:** `signVeiledhoodWithdrawAuth` currently hard-codes Base env (`RPC_URL`/`VAULT_ADDRESS`/`CHAIN_ID`). The orchestrator's source=Eth direction will need a chain-parameterized signer; resolve that in Plan 3 (parameterize the signer or add an Eth variant), not here.
