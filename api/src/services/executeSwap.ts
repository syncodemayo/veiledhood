import { ethers } from "ethers";
import { Swap } from "../models/Swap.js";
import { SwapUserBalance } from "../models/SwapUserBalance.js";
import type { Env } from "../config/env.js";
import { VEILSWAP_ABI } from "../abi/veilSwap.js";
import { buildSwapMerkleTree, getProofForLeaf } from "./veilswapLeaves.js";
import type { VeiledhoodMerkleTree } from "./merkleTree.js";
import { sendDeployerContractTx } from "./deployerTxQueue.js";
import { withdrawNullifier } from "./signWithdrawAuth.js";
import { createJsonRpcProvider } from "../util/jsonRpcProvider.js";
import { computeTransferTotalFees } from "../util/transferFees.js";

export class SwapNotConfiguredError extends Error {
  constructor() {
    super(
      "VeilSwap payout not configured (set RPC_URL, VEILSWAP_ADDRESS, ADMIN_PRIVATE_KEY, SIGNER_PRIVATE_KEY)"
    );
    this.name = "SwapNotConfiguredError";
  }
}

export class InsufficientSwapBalanceError extends Error {
  constructor(available: string, requested: string) {
    super(`Insufficient VeilSwap balance: have ${available}, need ${requested}`);
    this.name = "InsufficientSwapBalanceError";
  }
}

function assertSwapEnv(env: Env): {
  rpc: string;
  vault: string;
  adminPk: string;
  signerPk: string;
  staticChainId?: number;
} {
  const rpc = env.RPC_URL?.trim();
  const vault = env.VEILSWAP_ADDRESS?.trim();
  const adminPk = env.ADMIN_PRIVATE_KEY?.trim();
  const signerPk = env.SIGNER_PRIVATE_KEY?.trim();
  if (!rpc || !vault || !adminPk || !signerPk) {
    throw new SwapNotConfiguredError();
  }
  return {
    rpc,
    vault: ethers.getAddress(vault),
    adminPk,
    signerPk,
    staticChainId: env.CHAIN_ID,
  };
}

type CommitResult = {
  root: string;
  tree: import("./merkleTree.js").VeiledhoodMerkleTree;
  rows: { address: string; tokenAddress: string; totalAmount: string }[];
  txHash?: string;
  skipped: boolean;
};

export async function commitSwapMerkleRoot(params: {
  rpcUrl: string;
  vaultAddress: string;
  adminPrivateKey: string;
  staticChainId?: number;
  chainId: number;
}): Promise<CommitResult> {
  const { rpcUrl, vaultAddress, adminPrivateKey, staticChainId, chainId } = params;

  const rows = await SwapUserBalance.find({ chainId }).lean<
    { address: string; tokenAddress: string; totalAmount: string }[]
  >();
  const tree = await buildSwapMerkleTree(rows);
  const newRoot = tree.root;

  const provider = new ethers.JsonRpcProvider(rpcUrl, staticChainId, {
    staticNetwork: staticChainId != null,
  });
  const contract = new ethers.Contract(vaultAddress, VEILSWAP_ABI, provider);
  const onChain = (await contract.getMerkleRoot()) as string;

  if (onChain.toLowerCase() === newRoot.toLowerCase()) {
    return { root: newRoot, tree, rows, skipped: true };
  }

  const receipt = await sendDeployerContractTx({
    rpcUrl,
    privateKey: adminPrivateKey,
    staticChainId,
    send: async (wallet, nonce) => {
      const c = new ethers.Contract(vaultAddress, VEILSWAP_ABI, wallet);
      return c.updateMerkleRoot(newRoot, { nonce });
    },
  });

  return { root: newRoot, tree, rows, txHash: receipt.hash, skipped: false };
}

async function readOnChainMerkleRoot(
  rpcUrl: string,
  vaultAddress: string,
  staticChainId?: number
): Promise<string> {
  const provider = createJsonRpcProvider(rpcUrl, staticChainId);
  const contract = new ethers.Contract(vaultAddress, VEILSWAP_ABI, provider);
  return (await contract.getMerkleRoot()) as string;
}

/**
 * Poll the on-chain Merkle root until it equals `expectedRoot`, or fail after
 * a few tries. Load-balanced RPC providers (e.g. Alchemy) can briefly serve a
 * stale block right after a tx mines, so we need a short propagation grace.
 *
 * Returns true if the root converged to `expectedRoot`, false otherwise.
 */
async function waitForOnChainRoot(params: {
  rpcUrl: string;
  vaultAddress: string;
  expectedRoot: string;
  staticChainId?: number;
  /** Total attempts (default 6 ≈ ~6s). */
  maxAttempts?: number;
  /** Base sleep between attempts in ms (default 500). */
  baseDelayMs?: number;
}): Promise<{ matched: boolean; lastObserved: string }> {
  const {
    rpcUrl,
    vaultAddress,
    expectedRoot,
    staticChainId,
    maxAttempts = 6,
    baseDelayMs = 500,
  } = params;
  const expected = expectedRoot.toLowerCase();

  let observed = "";
  for (let i = 0; i < maxAttempts; i += 1) {
    observed = (
      await readOnChainMerkleRoot(rpcUrl, vaultAddress, staticChainId)
    ).toLowerCase();
    if (observed === expected) return { matched: true, lastObserved: observed };
    // Linear-ish backoff: 500ms, 750ms, 1000ms, 1500ms, 2000ms…
    const delay = baseDelayMs + Math.floor(i * baseDelayMs * 0.75);
    await new Promise((r) => setTimeout(r, delay));
  }
  return { matched: false, lastObserved: observed };
}

async function markSwapFailure(
  idempotencyKey: string,
  err: unknown
): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  const current = await Swap.findOne({ idempotencyKey })
    .select("swapTxHash")
    .lean<{ swapTxHash?: string } | null>();
  const status = current?.swapTxHash ? "swap_completed" : "failed";
  await Swap.updateOne({ idempotencyKey }, { $set: { payoutError: msg, status } });
}

/**
 * Find the most recent on-chain AdminWithdrawal(user, token, ...) event so we
 * can recover the missing `adminWithdrawTxHash` when the DB write was lost
 * after a successful payout (e.g. process restart between writes).
 *
 * Returns the transaction hash of the most recent matching event, or null if
 * none is found within the search window.
 */
async function findAdminWithdrawalTxHash(params: {
  rpcUrl: string;
  vaultAddress: string;
  staticChainId?: number;
  user: string;
  token: string;
  /** How many blocks back to look. ~2h on Base @ 2s/block = ~3600 blocks. */
  lookbackBlocks?: number;
}): Promise<string | null> {
  try {
    const provider = createJsonRpcProvider(params.rpcUrl, params.staticChainId);
    const vault = new ethers.Contract(
      params.vaultAddress,
      VEILSWAP_ABI,
      provider
    );
    const latest = await provider.getBlockNumber();
    const lookback = params.lookbackBlocks ?? 3600;
    const fromBlock = Math.max(0, latest - lookback);
    const filter = vault.filters.AdminWithdrawal(
      ethers.getAddress(params.user),
      ethers.getAddress(params.token)
    );
    const events = await vault.queryFilter(filter, fromBlock, latest);
    if (events.length === 0) return null;
    const newest = events[events.length - 1];
    return newest.transactionHash ?? null;
  } catch (err) {
    console.warn(
      `[veilswap] findAdminWithdrawalTxHash failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return null;
  }
}

/**
 * Pays out the recipient's full tokenOut ledger balance after the on-chain swap.
 * Used for the tail of executeSwap and to resume swaps that failed during payout.
 */
async function executeSwapPayout(
  env: Env,
  idempotencyKey: string,
  swap: {
    toAddress: string;
    tokenOut: string;
    adminWithdrawTxHash?: string;
  }
): Promise<void> {
  const cfg = assertSwapEnv(env);
  const chainId = env.CHAIN_ID ?? 8453;

  if (swap.adminWithdrawTxHash) return;

  const deadline =
    BigInt(Math.floor(Date.now() / 1000)) +
    BigInt(env.WITHDRAW_DEADLINE_MAX_SEC);

  const tokenOut = ethers.getAddress(swap.tokenOut);
  const toAddress = ethers.getAddress(swap.toAddress).toLowerCase();
  const tokenOutAddr = tokenOut.toLowerCase();

  const bal = await SwapUserBalance.findOne({
    address: toAddress,
    chainId,
    tokenAddress: tokenOutAddr,
  }).lean<{ totalAmount?: string } | null>();

  const withdrawBalance = BigInt(bal?.totalAmount ?? "0");
  if (withdrawBalance === 0n) {
    // Salvage path: the on-chain adminWithdraw can succeed and zero the ledger,
    // but a crash/hot-reload between the balance-zero write and the Swap status
    // update can leave the row in `swap_completed` with no adminWithdrawTxHash.
    // In that state the on-chain payout already happened — try to recover the
    // missing tx hash from the AdminWithdrawal event log, then mark complete.
    console.warn(
      `[veilswap] ${idempotencyKey}: tokenOut ledger already zero with no ` +
        `adminWithdrawTxHash; attempting on-chain log recovery.`
    );
    const recoveredHash = await findAdminWithdrawalTxHash({
      rpcUrl: cfg.rpc,
      vaultAddress: cfg.vault,
      staticChainId: cfg.staticChainId,
      user: toAddress,
      token: tokenOut,
    });
    await Swap.updateOne(
      { idempotencyKey },
      {
        $set: {
          status: "payout_completed",
          ...(recoveredHash ? { adminWithdrawTxHash: recoveredHash } : {}),
        },
        $unset: { payoutError: "" },
      }
    );
    if (recoveredHash) {
      console.warn(
        `[veilswap] ${idempotencyKey}: recovered adminWithdrawTxHash=${recoveredHash} from on-chain log.`
      );
    } else {
      console.warn(
        `[veilswap] ${idempotencyKey}: could not recover adminWithdrawTxHash from logs (continuing without).`
      );
    }
    return;
  }

  // Commit post-swap Merkle root, then wait for the RPC to converge. Retry the
  // commit if the root genuinely drifts (concurrent payout / swap / RPC lag).
  let m3 = await commitSwapMerkleRoot({
    rpcUrl: cfg.rpc,
    vaultAddress: cfg.vault,
    adminPrivateKey: cfg.adminPk,
    staticChainId: cfg.staticChainId,
    chainId,
  });

  let lastObservedPayoutRoot = "";
  let payoutRootMatched = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await waitForOnChainRoot({
      rpcUrl: cfg.rpc,
      vaultAddress: cfg.vault,
      expectedRoot: m3.root,
      staticChainId: cfg.staticChainId,
    });
    lastObservedPayoutRoot = result.lastObserved;
    if (result.matched) {
      payoutRootMatched = true;
      break;
    }
    console.warn(
      `[veilswap] Post-swap root drifted after commit (attempt ${attempt + 1}/3). ` +
        `expected=${m3.root} observed=${lastObservedPayoutRoot}. Re-committing…`
    );
    m3 = await commitSwapMerkleRoot({
      rpcUrl: cfg.rpc,
      vaultAddress: cfg.vault,
      adminPrivateKey: cfg.adminPk,
      staticChainId: cfg.staticChainId,
      chainId,
    });
  }

  if (m3.txHash) {
    await Swap.updateOne(
      { idempotencyKey },
      { $set: { merkleAfterSwapTxHash: m3.txHash } }
    );
  }

  if (!payoutRootMatched) {
    throw new Error(
      `Merkle root mismatch after updateMerkleRoot (payout phase): ` +
        `expected=${m3.root} observed=${lastObservedPayoutRoot}`
    );
  }

  const withdrawProof = getProofForLeaf(
    m3.tree,
    ethers.getAddress(toAddress),
    tokenOut,
    withdrawBalance
  );

  const withdrawSig = await signWithdrawAuth({
    signerPk: cfg.signerPk,
    rpcUrl: cfg.rpc,
    vaultAddress: cfg.vault,
    staticChainId: cfg.staticChainId,
    merkleRoot: m3.root,
    user: toAddress,
    token: tokenOut,
    balance: withdrawBalance,
    deadline,
  });

  const withdrawReceipt = await sendDeployerContractTx({
    rpcUrl: cfg.rpc,
    privateKey: cfg.adminPk,
    staticChainId: cfg.staticChainId,
    send: async (wallet, nonce) => {
      const c = new ethers.Contract(cfg.vault, VEILSWAP_ABI, wallet);
      return c.adminWithdraw(
        ethers.getAddress(toAddress),
        tokenOut,
        withdrawBalance,
        withdrawProof,
        deadline,
        withdrawSig,
        { nonce }
      );
    },
  });

  // Record the tx hash + final status FIRST so a crash or hot-reload between
  // the two writes can't leave the swap stuck in `swap_completed` forever.
  // The ledger zero-out is bookkeeping and the next swap's tree rebuild will
  // re-derive correct state regardless.
  await Swap.updateOne(
    { idempotencyKey },
    {
      $set: {
        adminWithdrawTxHash: withdrawReceipt.hash,
        status: "payout_completed",
      },
      $unset: { payoutError: "" },
    }
  );

  await SwapUserBalance.findOneAndUpdate(
    { address: toAddress, chainId, tokenAddress: tokenOutAddr },
    { $set: { totalAmount: "0" } }
  );
}

async function signWithdrawAuth(params: {
  signerPk: string;
  rpcUrl: string;
  vaultAddress: string;
  staticChainId?: number;
  merkleRoot: string;
  user: string;
  token: string;
  balance: bigint;
  deadline: bigint;
}): Promise<string> {
  const {
    signerPk,
    rpcUrl,
    vaultAddress,
    staticChainId,
    merkleRoot,
    user,
    token,
    balance,
    deadline,
  } = params;

  const provider = createJsonRpcProvider(rpcUrl, staticChainId);
  const network = await provider.getNetwork();
  const wallet = new ethers.Wallet(signerPk, provider);

  const nullifier = withdrawNullifier(
    merkleRoot,
    ethers.getAddress(user),
    ethers.getAddress(token),
    balance
  );

  const domain = {
    name: "VeilSwap",
    version: "1",
    chainId: network.chainId,
    verifyingContract: ethers.getAddress(vaultAddress),
  };

  const types = {
    WithdrawAuth: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "nullifier", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const message = {
    user: ethers.getAddress(user),
    token: ethers.getAddress(token),
    balance,
    nullifier,
    deadline,
  };

  return wallet.signTypedData(domain, types, message);
}

/**
 * Orchestrates the full on-chain swap flow for a pending Swap record:
 *   tx1: updateMerkleRoot (with user's tokenIn leaf)
 *   tx2: adminExecuteSwap → amountOut
 *   DB: tokenIn → 0, tokenOut += amountOut
 *   tx3: updateMerkleRoot (with user's tokenOut leaf)
 *   tx4: adminWithdraw (pays toAddress)
 */
export async function executeSwap(
  env: Env,
  idempotencyKey: string
): Promise<void> {
  const cfg = assertSwapEnv(env);
  const chainId = env.CHAIN_ID ?? 8453;

  const swap = await Swap.findOne({ idempotencyKey });
  if (!swap) throw new Error(`Swap ${idempotencyKey} not found`);
  if (swap.status === "payout_completed" || swap.adminWithdrawTxHash) return;

  // On-chain swap already done — only finish wallet payout.
  if (swap.swapTxHash) {
    try {
      await executeSwapPayout(env, idempotencyKey, swap);
    } catch (err: unknown) {
      await markSwapFailure(idempotencyKey, err);
      throw err;
    }
    return;
  }

  if (swap.status !== "pending") return;

  const deadline =
    BigInt(Math.floor(Date.now() / 1000)) +
    BigInt(env.WITHDRAW_DEADLINE_MAX_SEC);

  try {
    // --- tx1: commit Merkle root that includes user's tokenIn leaf ---
    // After committing, wait for the RPC to converge on the new root (Alchemy
    // load-balances reads, so a fresh node may still serve the previous block
    // briefly). If the root genuinely drifts (e.g. a concurrent payout updated
    // it), re-commit up to a few times.
    let m1 = await commitSwapMerkleRoot({
      rpcUrl: cfg.rpc,
      vaultAddress: cfg.vault,
      adminPrivateKey: cfg.adminPk,
      staticChainId: cfg.staticChainId,
      chainId,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { matched, lastObserved } = await waitForOnChainRoot({
        rpcUrl: cfg.rpc,
        vaultAddress: cfg.vault,
        expectedRoot: m1.root,
        staticChainId: cfg.staticChainId,
      });
      if (matched) break;
      console.warn(
        `[veilswap] Pre-swap root drifted after commit (attempt ${attempt + 1}/3). ` +
          `expected=${m1.root} observed=${lastObserved}. Re-committing…`
      );
      m1 = await commitSwapMerkleRoot({
        rpcUrl: cfg.rpc,
        vaultAddress: cfg.vault,
        adminPrivateKey: cfg.adminPk,
        staticChainId: cfg.staticChainId,
        chainId,
      });
    }

    if (m1.txHash) {
      await Swap.updateOne(
        { idempotencyKey },
        { $set: { merkleBeforeSwapTxHash: m1.txHash } }
      );
    }

    // Use the tree from m1 directly — same snapshot the root was committed from.
    // Never re-query DB here; a concurrent write between tx1 and this point
    // would make the proof target a different tree than what's on-chain.
    const { tree: treeBefore, rows: rowsBefore } = m1;

    const tokenIn = ethers.getAddress(swap.tokenIn);
    const tokenOut = ethers.getAddress(swap.tokenOut);
    const user = ethers.getAddress(swap.fromAddress);

    const balRow = rowsBefore.find(
      (r) =>
        r.address.toLowerCase() === user.toLowerCase() &&
        r.tokenAddress.toLowerCase() === tokenIn.toLowerCase()
    );
    if (!balRow || BigInt(balRow.totalAmount) === 0n) {
      throw new Error(`No VeilSwap balance for ${user} / ${tokenIn}`);
    }
    const amountIn = BigInt(balRow.totalAmount);
    const amountOutMin = BigInt(swap.amountOutMin);

    const proof = getProofForLeaf(treeBefore, user, tokenIn, amountIn);

    // Compute nullifier for SwapAuth
    // --- tx2: adminExecuteSwap ---
    let amountOut: bigint | undefined;
    const swapReceipt = await sendDeployerContractTx({
      rpcUrl: cfg.rpc,
      privateKey: cfg.adminPk,
      staticChainId: cfg.staticChainId,
      send: async (wallet, nonce) => {
        const c = new ethers.Contract(cfg.vault, VEILSWAP_ABI, wallet);
        return c.adminExecuteSwap(
          user,
          tokenIn,
          tokenOut,
          amountIn,
          amountOutMin,
          {
            currency0:   ethers.getAddress(swap.poolKey.currency0.toLowerCase()),
            currency1:   ethers.getAddress(swap.poolKey.currency1.toLowerCase()),
            fee:         swap.poolKey.fee,
            tickSpacing: swap.poolKey.tickSpacing,
            hooks:       ethers.getAddress(swap.poolKey.hooks.toLowerCase()),
          },
          proof,
          deadline,
          { nonce }
        );
      },
    });

    // Parse amountOut from SwapExecuted event
    const iface = new ethers.Interface([...VEILSWAP_ABI]);
    for (const log of swapReceipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === "SwapExecuted") {
          amountOut = parsed.args.amountOut as bigint;
          break;
        }
      } catch {
        // not SwapExecuted
      }
    }

    if (amountOut === undefined) {
      throw new Error("SwapExecuted event not found in adminExecuteSwap receipt");
    }

    await Swap.updateOne(
      { idempotencyKey },
      {
        $set: {
          swapTxHash: swapReceipt.hash,
          amountOut: amountOut.toString(),
          status: "swap_completed",
        },
      }
    );

    // --- DB: debit tokenIn, credit tokenOut (minus fees) ---
    const tokenInAddr = tokenIn.toLowerCase();
    const tokenOutAddr = tokenOut.toLowerCase();
    const toAddress = ethers.getAddress(swap.toAddress).toLowerCase();

    // Compute off-chain swap fee: BPS on amountOut + fixed ETH if tokenOut is native
    const feeBps = env.VEILSWAP_FEE_BPS ?? 0;
    const feeFixedEth = BigInt(env.VEILSWAP_FEE_FIXED_ETH ?? "0");
    const feeFixed = tokenOut === ethers.ZeroAddress ? feeFixedEth : 0n;
    const feeAmount = computeTransferTotalFees(amountOut, feeFixed, feeBps);
    const userNetAmount = amountOut > feeAmount ? amountOut - feeAmount : 0n;

    await SwapUserBalance.findOneAndUpdate(
      { address: user.toLowerCase(), chainId, tokenAddress: tokenInAddr },
      { $set: { totalAmount: "0" } }
    );

    const prevOut = await SwapUserBalance.findOne({
      address: toAddress,
      chainId,
      tokenAddress: tokenOutAddr,
    }).lean<{ totalAmount?: string } | null>();
    const prevOutAmount = BigInt(prevOut?.totalAmount ?? "0");
    const nextOutAmount = (prevOutAmount + userNetAmount).toString();

    await SwapUserBalance.findOneAndUpdate(
      { address: toAddress, chainId, tokenAddress: tokenOutAddr },
      {
        $set: {
          address: toAddress,
          chainId,
          tokenAddress: tokenOutAddr,
          totalAmount: nextOutAmount,
        },
      },
      { upsert: true }
    );

    // Credit fee to treasury
    if (feeAmount > 0n && env.VEILSWAP_TREASURY_ADDRESS) {
      const treasuryAddr = env.VEILSWAP_TREASURY_ADDRESS.toLowerCase();
      const prevTreasury = await SwapUserBalance.findOne({
        address: treasuryAddr,
        chainId,
        tokenAddress: tokenOutAddr,
      }).lean<{ totalAmount?: string } | null>();
      const prevTreasuryAmount = BigInt(prevTreasury?.totalAmount ?? "0");
      await SwapUserBalance.findOneAndUpdate(
        { address: treasuryAddr, chainId, tokenAddress: tokenOutAddr },
        {
          $set: {
            address: treasuryAddr,
            chainId,
            tokenAddress: tokenOutAddr,
            totalAmount: (prevTreasuryAmount + feeAmount).toString(),
          },
        },
        { upsert: true }
      );
    }

    // --- tx3 + tx4: commit post-swap Merkle root and pay out full tokenOut ledger ---
    const refreshed = await Swap.findOne({ idempotencyKey });
    if (!refreshed) throw new Error(`Swap ${idempotencyKey} not found`);
    await executeSwapPayout(env, idempotencyKey, refreshed);
  } catch (err: unknown) {
    await markSwapFailure(idempotencyKey, err);
    throw err;
  }
}

/**
 * Resume a failed or incomplete swap from the last persisted step.
 * Resets status to "pending" and re-runs executeSwap.
 */
export async function resumeSwapIfNeeded(
  env: Env,
  idempotencyKey: string
): Promise<void> {
  const swap = await Swap.findOne({ idempotencyKey })
    .select("status swapTxHash adminWithdrawTxHash")
    .lean<{
      status?: string;
      swapTxHash?: string;
      adminWithdrawTxHash?: string;
    } | null>();

  if (!swap || swap.status === "payout_completed") return;
  if (swap.adminWithdrawTxHash) return;

  if (swap.swapTxHash) {
    await Swap.updateOne(
      { idempotencyKey },
      { $set: { status: "swap_completed" }, $unset: { payoutError: "" } }
    );
  } else {
    await Swap.updateOne(
      { idempotencyKey },
      { $set: { status: "pending" }, $unset: { payoutError: "" } }
    );
  }

  await executeSwap(env, idempotencyKey);
}
