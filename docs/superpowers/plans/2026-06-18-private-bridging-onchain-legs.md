# Private Bridging — Plan 3a: On-Chain Leg Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the chain-touching building blocks the orchestrator (Plan 3b) composes: a chain-env selector (Base vs Eth), escrow gas top-up + raw-tx helpers, the **source escrow-leaf withdrawal** (split → root → adminWithdraw to escrow → zero → root), and the **destination deposit + shielded credit**. No HTTP, no state machine — those are Plan 3b.

**Architecture:** Pure additive `api/` services that reuse `veiledhoodAdmin`, `merkleTree`, `signWithdrawAuth`, and the Plan 1 ledger split. The Base-hardcoded signer (`signVeiledhoodWithdrawAuth`) is handled by passing it a per-chain "effective env" (the existing `{ ...env, RPC_URL: ETH_RPC_URL, ... }` idiom used by `/eth/transfers` and boot resume). Fresh escrow addresses are funded with a small gas top-up from the admin wallet before they transact.

**Tech Stack:** TypeScript ESM, ethers v6, `node:test` + `mongodb-memory-server`.

**Spec:** `docs/superpowers/specs/2026-06-18-private-base-eth-bridging-design.md`
**Depends on:** Plan 1 (Bridge model, escrow derivation, ledger split), Plan 2 (deBridge client).

---

## File Structure

| File | Responsibility | C/M |
|---|---|---|
| `api/src/services/bridgeChainEnv.ts` | Map a chainId → effective Env (Base as-is / Eth overrides) + config assertion | Create |
| `api/src/services/bridgeEscrowTx.ts` | Gas top-up math + send native gas from admin + send a raw tx from an escrow wallet | Create |
| `api/src/services/bridgeSourceWithdraw.ts` | Off-chain split → commit root → adminWithdraw the escrow leaf → zero leaf → commit root | Create |
| `api/src/services/bridgeDestCredit.ts` | Escrow `deposit()` into dest vault → credit user's fresh shielded leaf → commit root | Create |
| `*.test.ts` for each | Unit tests (pure logic + mongo-memory where DB is touched) | Create |

**Run:** `cd api && npx tsx --test src/services/bridge*.test.ts`

---

## Task 1: Chain-env selector

Resolves the Base-hardcoded-signer problem. `bridgeChainEnv(env, chainId)` returns an `Env` whose `RPC_URL`/`VAULT_ADDRESS`/`CHAIN_ID` point at the requested chain, so every Base-assuming helper (`signVeiledhoodWithdrawAuth`, `commitMerkleRootFromDb`, `submitAdminWithdraw`) works for Eth unchanged.

**Files:** Create `api/src/services/bridgeChainEnv.ts`, `api/src/services/bridgeChainEnv.test.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// api/src/services/bridgeChainEnv.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Env } from "../config/env.js";
import { bridgeChainEnv, BridgeChainNotConfiguredError } from "./bridgeChainEnv.js";

const base = {
  RPC_URL: "https://base.rpc",
  VAULT_ADDRESS: "0xBaseVault000000000000000000000000000000",
  CHAIN_ID: 8453,
  BASE_CHAIN_ID: 8453,
  ETH_RPC_URL: "https://eth.rpc",
  ETH_VAULT_ADDRESS: "0xEthVault0000000000000000000000000000000",
  ETH_CHAIN_ID: 1,
  ADMIN_PRIVATE_KEY: "0x" + "1".repeat(64),
  SIGNER_PRIVATE_KEY: "0x" + "2".repeat(64),
} as unknown as Env;

test("returns base env for the Base chain id", () => {
  const e = bridgeChainEnv(base, 8453);
  assert.equal(e.RPC_URL, "https://base.rpc");
  assert.equal(e.VAULT_ADDRESS, "0xBaseVault000000000000000000000000000000");
  assert.equal(e.CHAIN_ID, 8453);
});

test("overrides with ETH config for the Eth chain id", () => {
  const e = bridgeChainEnv(base, 1);
  assert.equal(e.RPC_URL, "https://eth.rpc");
  assert.equal(e.VAULT_ADDRESS, "0xEthVault0000000000000000000000000000000");
  assert.equal(e.CHAIN_ID, 1);
});

test("throws for an unsupported chain id", () => {
  assert.throws(() => bridgeChainEnv(base, 137), /unsupported bridge chain/i);
});

test("throws when Eth requested but not configured", () => {
  const noEth = { ...base, ETH_RPC_URL: undefined, ETH_VAULT_ADDRESS: undefined } as Env;
  assert.throws(() => bridgeChainEnv(noEth, 1), BridgeChainNotConfiguredError);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx tsx --test src/services/bridgeChainEnv.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// api/src/services/bridgeChainEnv.ts
import type { Env } from "../config/env.js";

export class BridgeChainNotConfiguredError extends Error {
  constructor(chainId: number) {
    super(`bridge chain ${chainId} not configured (missing RPC_URL/VAULT_ADDRESS)`);
    this.name = "BridgeChainNotConfiguredError";
  }
}

/** Resolve the effective per-chain Env so Base-assuming helpers work for either chain. */
export function bridgeChainEnv(env: Env, chainId: number): Env {
  const baseId = env.CHAIN_ID ?? env.BASE_CHAIN_ID ?? 8453;
  const ethId = env.ETH_CHAIN_ID ?? 1;

  if (chainId === baseId) {
    if (!env.RPC_URL?.trim() || !env.VAULT_ADDRESS?.trim()) {
      throw new BridgeChainNotConfiguredError(chainId);
    }
    return { ...env, CHAIN_ID: baseId };
  }
  if (chainId === ethId) {
    if (!env.ETH_RPC_URL?.trim() || !env.ETH_VAULT_ADDRESS?.trim()) {
      throw new BridgeChainNotConfiguredError(chainId);
    }
    return {
      ...env,
      RPC_URL: env.ETH_RPC_URL.trim(),
      VAULT_ADDRESS: env.ETH_VAULT_ADDRESS,
      CHAIN_ID: ethId,
    };
  }
  throw new Error(`unsupported bridge chain id ${chainId}`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd api && npx tsx --test src/services/bridgeChainEnv.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/services/bridgeChainEnv.ts api/src/services/bridgeChainEnv.test.ts
git commit -m "feat(bridge): per-chain effective-env selector (Base/Eth)"
```

---

## Task 2: Escrow gas top-up + raw-tx helpers

Fresh escrow addresses hold no ETH, so they cannot pay gas. Before an escrow submits a tx (the deBridge order on the source; `deposit()` on the destination), the admin wallet sends it a small native top-up. `computeGasTopUp` decides how much; `fundEscrowGas` sends it; `sendEscrowTx` submits a signed tx from the escrow wallet and waits for the receipt.

**Files:** Create `api/src/services/bridgeEscrowTx.ts`, `api/src/services/bridgeEscrowTx.test.ts`.

- [ ] **Step 1: Write the failing test (pure top-up math)**

```typescript
// api/src/services/bridgeEscrowTx.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGasTopUp } from "./bridgeEscrowTx.js";

test("computeGasTopUp = gasLimit * gasPrice * buffer", () => {
  // 300000 gas * 2 gwei * 1.5 buffer = 900000 * 1e9 = 9e14 wei
  const topUp = computeGasTopUp({
    gasLimit: 300_000n,
    gasPriceWei: 2_000_000_000n,
    bufferPct: 50,
  });
  assert.equal(topUp, 900_000n * 1_000_000_000n);
});

test("computeGasTopUp never returns below the floor", () => {
  const topUp = computeGasTopUp({
    gasLimit: 1n,
    gasPriceWei: 1n,
    bufferPct: 0,
    floorWei: 100_000_000_000_000n, // 0.0001 ETH
  });
  assert.equal(topUp, 100_000_000_000_000n);
});

test("computeGasTopUp rejects non-positive inputs", () => {
  assert.throws(() => computeGasTopUp({ gasLimit: 0n, gasPriceWei: 1n, bufferPct: 0 }), /gasLimit/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx tsx --test src/services/bridgeEscrowTx.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// api/src/services/bridgeEscrowTx.ts
import { ethers } from "ethers";
import { createJsonRpcProvider } from "../util/jsonRpcProvider.js";

/** Wei to send an escrow so it can afford one tx: gasLimit * gasPrice * (1 + buffer), floored. */
export function computeGasTopUp(params: {
  gasLimit: bigint;
  gasPriceWei: bigint;
  bufferPct: number;
  floorWei?: bigint;
}): bigint {
  const { gasLimit, gasPriceWei, bufferPct, floorWei = 0n } = params;
  if (gasLimit <= 0n) throw new Error("gasLimit must be positive");
  if (gasPriceWei <= 0n) throw new Error("gasPriceWei must be positive");
  const base = gasLimit * gasPriceWei;
  const withBuffer = base + (base * BigInt(Math.max(0, Math.floor(bufferPct)))) / 100n;
  return withBuffer > floorWei ? withBuffer : floorWei;
}

/** Send a native-ETH gas top-up from the admin wallet to an escrow address. Returns tx hash. */
export async function fundEscrowGas(params: {
  rpcUrl: string;
  staticChainId?: number;
  adminPrivateKey: string;
  escrowAddress: string;
  amountWei: bigint;
}): Promise<{ txHash: string }> {
  const { rpcUrl, staticChainId, adminPrivateKey, escrowAddress, amountWei } = params;
  const provider = createJsonRpcProvider(rpcUrl, staticChainId);
  const admin = new ethers.Wallet(adminPrivateKey, provider);
  const tx = await admin.sendTransaction({
    to: ethers.getAddress(escrowAddress),
    value: amountWei,
  });
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error("gas top-up receipt missing");
  return { txHash: receipt.hash };
}

/** Submit a pre-built tx (e.g. deBridge order calldata) FROM an escrow wallet; wait 1 conf. */
export async function sendEscrowTx(params: {
  rpcUrl: string;
  staticChainId?: number;
  escrowWallet: ethers.HDNodeWallet;
  to: string;
  data?: string;
  valueWei?: bigint;
}): Promise<{ txHash: string }> {
  const { rpcUrl, staticChainId, escrowWallet, to, data, valueWei } = params;
  const provider = createJsonRpcProvider(rpcUrl, staticChainId);
  const wallet = escrowWallet.connect(provider);
  const tx = await wallet.sendTransaction({
    to: ethers.getAddress(to),
    data: data ?? "0x",
    value: valueWei ?? 0n,
  });
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error("escrow tx receipt missing");
  return { txHash: receipt.hash };
}

/** Read the current gas price (wei) for top-up sizing. */
export async function currentGasPriceWei(
  rpcUrl: string,
  staticChainId?: number
): Promise<bigint> {
  const provider = createJsonRpcProvider(rpcUrl, staticChainId);
  const fee = await provider.getFeeData();
  return fee.gasPrice ?? fee.maxFeePerGas ?? 1_000_000_000n;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd api && npx tsx --test src/services/bridgeEscrowTx.test.ts`
Expected: PASS — 3 tests (the chain-touching functions are exercised in Plan 3b staging E2E, mirroring how `veiledhoodAdmin`'s on-chain calls are tested).

- [ ] **Step 5: Commit**

```bash
git add api/src/services/bridgeEscrowTx.ts api/src/services/bridgeEscrowTx.test.ts
git commit -m "feat(bridge): escrow gas top-up + raw escrow-tx send helpers"
```

---

## Task 3: Source escrow-leaf withdrawal

Moves `amount` from the user's leaf into a fresh escrow leaf, then pays that escrow leaf out on-chain so the funds sit at the escrow address ready to bridge. Mirrors `transferMerklePayout` exactly, but the payee is the escrow address (not a recipient) and the leaf balance is the escrow's split amount (not a pre-existing balance). Uses `bridgeChainEnv` so it works on Base or Eth.

**Files:** Create `api/src/services/bridgeSourceWithdraw.ts`, `api/src/services/bridgeSourceWithdraw.test.ts`.

- [ ] **Step 1: Write the failing test (mongo-memory; mock the on-chain calls)**

```typescript
// api/src/services/bridgeSourceWithdraw.test.ts
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { UserBalance } from "../models/UserBalance.js";

// We test the DB-side effects (split + zero) by injecting a fake "chain" that
// records calls and returns deterministic hashes, so no RPC is needed.
import { withdrawEscrowLeaf } from "./bridgeSourceWithdraw.js";

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

const fakeChain = {
  commitRoot: async () => ({ root: "0x" + "1".repeat(64), txHash: "0x" + "a".repeat(64), skipped: false }),
  proofForEscrow: async () => ["0x" + "b".repeat(64)],
  readRoot: async () => "0x" + "1".repeat(64),
  signAuth: async () => ({ signature: "0xsig", deadline: 1n }),
  adminWithdraw: async () => ({ txHash: "0x" + "c".repeat(64) }),
};

test("splits the user leaf, leaves escrow leaf zeroed after withdraw", async () => {
  const user = "0x1111111111111111111111111111111111111111";
  const escrow = "0x2222222222222222222222222222222222222222";
  await UserBalance.create({
    address: user, chainId: 8453, assetKey: "8453:usdc", currency: "usdc", totalAmount: "1000000",
  });

  const res = await withdrawEscrowLeaf({
    chainId: 8453,
    currency: "usdc",
    userAddress: user,
    escrowAddress: escrow,
    amount: 400000n,
    chain: fakeChain,
  });

  const u = await UserBalance.findOne({ address: user, chainId: 8453 }).lean<{ totalAmount?: string } | null>();
  const e = await UserBalance.findOne({ address: escrow, chainId: 8453 }).lean<{ totalAmount?: string } | null>();
  assert.equal(u?.totalAmount, "600000"); // user debited
  assert.equal(e?.totalAmount, "0"); // escrow leaf zeroed after payout
  assert.equal(res.adminWithdrawTxHash, "0x" + "c".repeat(64));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx tsx --test src/services/bridgeSourceWithdraw.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// api/src/services/bridgeSourceWithdraw.ts
import { ethers } from "ethers";
import { UserBalance } from "../models/UserBalance.js";
import type { Env } from "../config/env.js";
import { applyLedgerSplit } from "./bridgeLedgerSplit.js";
import { buildMerkleTree, getProofForLeaf } from "./merkleTree.js";
import {
  ledgerCurrencyToMerkleToken,
  userBalancesToMerkleLeaves,
} from "./ledgerLeaves.js";
import {
  commitMerkleRootFromDb,
  readMerkleRoot,
  submitAdminWithdraw,
} from "./veiledhoodAdmin.js";
import { signVeiledhoodWithdrawAuth } from "./signWithdrawAuth.js";
import { normalizeLedgerCurrency } from "../util/ledgerCurrency.js";
import { buildAssetKey } from "../util/chainLedger.js";

/** Indirection so the DB-side logic is unit-testable without RPC (see test). */
export interface SourceChainOps {
  commitRoot(): Promise<{ root: string; txHash?: string; skipped: boolean }>;
  readRoot(): Promise<string>;
  proofForEscrow(escrow: string, token: string, balance: bigint): Promise<string[]>;
  signAuth(args: {
    root: string;
    user: string;
    token: string;
    balance: bigint;
  }): Promise<{ signature: string; deadline: bigint }>;
  adminWithdraw(args: {
    user: string;
    token: string;
    balance: bigint;
    proof: string[];
    deadline: bigint;
    signature: string;
  }): Promise<{ txHash: string }>;
}

/** Production SourceChainOps bound to a per-chain effective env. */
export function makeSourceChainOps(env: Env): SourceChainOps {
  const rpc = env.RPC_URL!.trim();
  const vault = ethers.getAddress(env.VAULT_ADDRESS!.trim());
  const adminPk = env.ADMIN_PRIVATE_KEY!.trim();
  const staticChainId = env.CHAIN_ID;
  return {
    commitRoot: () =>
      commitMerkleRootFromDb({ rpcUrl: rpc, vaultAddress: vault, adminPrivateKey: adminPk, staticChainId }),
    readRoot: () => readMerkleRoot(rpc, vault, staticChainId),
    async proofForEscrow(escrow, token, balance) {
      const rows = await UserBalance.find({ chainId: staticChainId }).lean<
        { address: string; currency: string; totalAmount: string }[]
      >();
      const tree = buildMerkleTree(userBalancesToMerkleLeaves(rows));
      return getProofForLeaf(tree, escrow, token, balance);
    },
    async signAuth({ root, user, token, balance }) {
      const deadline = BigInt(Math.floor(Date.now() / 1000)) + BigInt(env.WITHDRAW_DEADLINE_MAX_SEC);
      const signed = await signVeiledhoodWithdrawAuth({ env, merkleRoot: root, user, token, balance, deadline });
      return { signature: signed.signature, deadline };
    },
    adminWithdraw: (a) =>
      submitAdminWithdraw({
        rpcUrl: rpc, vaultAddress: vault, adminPrivateKey: adminPk, staticChainId,
        user: a.user, token: a.token, balance: a.balance, proof: a.proof,
        deadline: a.deadline, signature: a.signature,
      }),
  };
}

export interface SourceWithdrawResult {
  rootAfterSplitTxHash?: string;
  adminWithdrawTxHash: string;
  rootAfterPayoutTxHash?: string;
}

/**
 * Split the user's leaf into a fresh escrow leaf and pay the escrow leaf out
 * on-chain. After this the escrow ADDRESS holds `amount` of `token`, and the
 * escrow LEAF is zeroed (so it can't be re-withdrawn).
 */
export async function withdrawEscrowLeaf(params: {
  chainId: number;
  currency: string;
  userAddress: string;
  escrowAddress: string;
  amount: bigint;
  chain: SourceChainOps;
}): Promise<SourceWithdrawResult> {
  const { chainId, currency, userAddress, escrowAddress, amount, chain } = params;
  const token = ledgerCurrencyToMerkleToken(currency);
  const cur = normalizeLedgerCurrency(currency);
  const assetKey = buildAssetKey(chainId, cur);

  // 1) Off-chain split: user -= amount, escrow += amount.
  await applyLedgerSplit({ userAddress, escrowAddress, chainId, currency, amount });

  // 2) Commit root #1 (now includes the escrow leaf).
  const m1 = await chain.commitRoot();
  const root = await chain.readRoot();

  // 3) Prove + sign + adminWithdraw the escrow leaf to the escrow address.
  const proof = await chain.proofForEscrow(escrowAddress, token, amount);
  const { signature, deadline } = await chain.signAuth({
    root, user: escrowAddress, token, balance: amount,
  });
  const { txHash } = await chain.adminWithdraw({
    user: escrowAddress, token, balance: amount, proof, deadline, signature,
  });

  // 4) Zero the escrow leaf, commit root #2.
  await UserBalance.findOneAndUpdate(
    { address: escrowAddress, chainId, assetKey },
    { $set: { address: escrowAddress, chainId, assetKey, currency: cur, totalAmount: "0" } },
    { upsert: true }
  );
  const m2 = await chain.commitRoot();

  return {
    rootAfterSplitTxHash: m1.txHash,
    adminWithdrawTxHash: txHash,
    rootAfterPayoutTxHash: m2.txHash,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd api && npx tsx --test src/services/bridgeSourceWithdraw.test.ts`
Expected: PASS — 1 test (DB effects verified; on-chain ops faked).

- [ ] **Step 5: Commit**

```bash
git add api/src/services/bridgeSourceWithdraw.ts api/src/services/bridgeSourceWithdraw.test.ts
git commit -m "feat(bridge): source escrow-leaf withdrawal (split -> root -> adminWithdraw -> zero)"
```

---

## Task 4: Destination deposit + shielded credit

The escrow address on the destination chain holds the bridged funds (`amountReceived`). This service deposits them into the destination vault and credits the user's fresh shielded leaf, then commits the destination root. `deposit(token, amount)` is called FROM the escrow wallet (ERC-20 needs an approve first; native ETH is sent as `value`).

**Files:** Create `api/src/services/bridgeDestCredit.ts`, `api/src/services/bridgeDestCredit.test.ts`.

- [ ] **Step 1: Write the failing test (mongo-memory; fake deposit op)**

```typescript
// api/src/services/bridgeDestCredit.test.ts
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { UserBalance } from "../models/UserBalance.js";
import { creditDestShielded } from "./bridgeDestCredit.js";

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

const fakeChain = {
  deposit: async () => ({ txHash: "0x" + "d".repeat(64) }),
  commitRoot: async () => ({ root: "0x" + "1".repeat(64), txHash: "0x" + "e".repeat(64), skipped: false }),
};

test("credits the destination shielded leaf with the received amount", async () => {
  const shielded = "0x5555555555555555555555555555555555555555";
  const res = await creditDestShielded({
    chainId: 1,
    currency: "usdc",
    shieldedAddress: shielded,
    amountReceived: 994000n,
    chain: fakeChain,
  });
  const row = await UserBalance.findOne({ address: shielded, chainId: 1 }).lean<{ totalAmount?: string } | null>();
  assert.equal(row?.totalAmount, "994000");
  assert.equal(res.depositTxHash, "0x" + "d".repeat(64));
});

test("adds to an existing shielded balance (does not overwrite)", async () => {
  const shielded = "0x5555555555555555555555555555555555555555";
  await UserBalance.create({
    address: shielded, chainId: 1, assetKey: "1:usdc", currency: "usdc", totalAmount: "1000",
  });
  await creditDestShielded({
    chainId: 1, currency: "usdc", shieldedAddress: shielded, amountReceived: 994000n, chain: fakeChain,
  });
  const row = await UserBalance.findOne({ address: shielded, chainId: 1 }).lean<{ totalAmount?: string } | null>();
  assert.equal(row?.totalAmount, "995000");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx tsx --test src/services/bridgeDestCredit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// api/src/services/bridgeDestCredit.ts
import { ethers } from "ethers";
import { UserBalance } from "../models/UserBalance.js";
import type { Env } from "../config/env.js";
import { VEILEDHOOD_ABI } from "../abi/veiledhood.js";
import { ledgerCurrencyToMerkleToken } from "./ledgerLeaves.js";
import { commitMerkleRootFromDb } from "./veiledhoodAdmin.js";
import { sendEscrowTx } from "./bridgeEscrowTx.js";
import { createJsonRpcProvider } from "../util/jsonRpcProvider.js";
import { normalizeLedgerCurrency } from "../util/ledgerCurrency.js";
import { buildAssetKey } from "../util/chainLedger.js";
import { DEBRIDGE_NATIVE } from "./deBridgeClient.js";

export interface DestChainOps {
  deposit(args: { token: string; amount: bigint }): Promise<{ txHash: string }>;
  commitRoot(): Promise<{ root: string; txHash?: string; skipped: boolean }>;
}

/** Production DestChainOps: escrow wallet approves (ERC-20) then calls vault.deposit. */
export function makeDestChainOps(params: {
  env: Env;
  escrowWallet: ethers.HDNodeWallet;
}): DestChainOps {
  const { env, escrowWallet } = params;
  const rpc = env.RPC_URL!.trim();
  const vault = ethers.getAddress(env.VAULT_ADDRESS!.trim());
  const staticChainId = env.CHAIN_ID;
  const adminPk = env.ADMIN_PRIVATE_KEY!.trim();

  return {
    async deposit({ token, amount }) {
      const provider = createJsonRpcProvider(rpc, staticChainId);
      const wallet = escrowWallet.connect(provider);
      const iface = new ethers.Interface([...VEILEDHOOD_ABI]);
      const isNative = token.toLowerCase() === DEBRIDGE_NATIVE;
      if (!isNative) {
        // ERC-20: approve the vault to pull `amount`.
        const erc20 = new ethers.Contract(
          token,
          ["function approve(address,uint256) returns (bool)"],
          wallet
        );
        const approveTx = await erc20.approve(vault, amount);
        await approveTx.wait(1);
      }
      const data = iface.encodeFunctionData("deposit", [token, amount]);
      return sendEscrowTx({
        rpcUrl: rpc,
        staticChainId,
        escrowWallet,
        to: vault,
        data,
        valueWei: isNative ? amount : 0n,
      });
    },
    commitRoot: () =>
      commitMerkleRootFromDb({
        rpcUrl: rpc,
        vaultAddress: vault,
        adminPrivateKey: adminPk,
        staticChainId,
      }),
  };
}

export interface DestCreditResult {
  depositTxHash: string;
  rootAfterCreditTxHash?: string;
}

/**
 * Deposit the bridged funds into the destination vault and credit the user's
 * fresh shielded leaf with `amountReceived`, then commit the destination root.
 */
export async function creditDestShielded(params: {
  chainId: number;
  currency: string;
  shieldedAddress: string;
  amountReceived: bigint;
  chain: DestChainOps;
}): Promise<DestCreditResult> {
  const { chainId, currency, shieldedAddress, amountReceived, chain } = params;
  const token = ledgerCurrencyToMerkleToken(currency);
  const cur = normalizeLedgerCurrency(currency);
  const assetKey = buildAssetKey(chainId, cur);

  // 1) Move the bridged funds into the vault reserves (escrow -> vault).
  const dep = await chain.deposit({ token, amount: amountReceived });

  // 2) Credit the user's shielded leaf (additive — preserve any prior balance).
  const existing = await UserBalance.findOne({
    address: shieldedAddress, chainId, assetKey,
  }).lean<{ totalAmount?: string } | null>();
  const next = BigInt(existing?.totalAmount ?? "0") + amountReceived;
  await UserBalance.findOneAndUpdate(
    { address: shieldedAddress, chainId, assetKey },
    { $set: { address: shieldedAddress, chainId, assetKey, currency: cur, totalAmount: next.toString() } },
    { upsert: true }
  );

  // 3) Commit destination root (now includes/updates the shielded leaf).
  const m = await chain.commitRoot();

  return { depositTxHash: dep.txHash, rootAfterCreditTxHash: m.txHash };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd api && npx tsx --test src/services/bridgeDestCredit.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Run full bridge suite + build**

Run: `cd api && npx tsx --test src/services/bridge*.test.ts src/models/Bridge.test.ts && npm run build`
Expected: all pass; `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add api/src/services/bridgeDestCredit.ts api/src/services/bridgeDestCredit.test.ts
git commit -m "feat(bridge): destination deposit + shielded credit"
```

---

## Self-Review

**Spec coverage (3a slice):** chain-parameterized signing (the spec's Plan-3 note) → Task 1 ✓; escrow gas funding (gap found during planning) → Task 2 ✓; source split→adminWithdraw→zero (mechanism §1 steps 1-2) → Task 3 ✓; dest deposit + fresh-shielded credit (§1 steps 4-5) → Task 4 ✓.
**Placeholder scan:** none.
**Type consistency:** `SourceChainOps`/`makeSourceChainOps`/`withdrawEscrowLeaf` and `DestChainOps`/`makeDestChainOps`/`creditDestShielded` are consistent across tests and impls; both leg services take a `chain` ops object so DB effects are unit-tested without RPC, and the `make*ChainOps(env)` factories bind the real on-chain calls (exercised in Plan 3b staging E2E).
**Carried to Plan 3b:** the orchestrator calls `bridgeChainEnv` → `makeSourceChainOps` / `makeDestChainOps`, sequences gas top-ups (`computeGasTopUp`/`currentGasPriceWei`/`fundEscrowGas`) before each escrow tx, submits the deBridge order via `sendEscrowTx`, polls `getOrderStatus` until `Fulfilled`, persists `Bridge` status at each step, and implements the refund path (re-credit user's source leaf if the bridge fails before fulfillment).
```
