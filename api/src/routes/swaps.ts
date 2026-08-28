import { Router } from "express";
import { ethers } from "ethers";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { recordSwapDeposit } from "../services/recordSwapDeposit.js";
import {
  executeSwap,
  InsufficientSwapBalanceError,
  resumeSwapIfNeeded,
  SwapNotConfiguredError,
} from "../services/executeSwap.js";

const payoutRetryInFlight = new Set<string>();
import { Swap } from "../models/Swap.js";
import { SwapUserBalance } from "../models/SwapUserBalance.js";
import { VEILSWAP_PAIRS } from "../config/veilswapPairs.js";
import { VEILSWAP_ABI } from "../abi/veilSwap.js";
import { buildSwapMerkleTree, getProofForLeaf } from "../services/veilswapLeaves.js";
import { withdrawNullifier } from "../services/signWithdrawAuth.js";
import { createJsonRpcProvider } from "../util/jsonRpcProvider.js";

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/, "idempotencyKey must be alphanumeric (dash/underscore ok)");

const swapDepositBodySchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  chainId: z.coerce.number().int().positive().optional(),
});

const swapBodySchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  tokenIn: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  tokenOut: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amountIn: z
    .string()
    .regex(/^\d+$/)
    .refine((s) => BigInt(s) > 0n, "amountIn must be positive"),
  amountOutMin: z.string().regex(/^\d+$/).default("0"),
  poolKey: z.object({
    currency0:   z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    currency1:   z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    // V4 PoolKey.fee is a uint24 (max 0xFFFFFF). Values ≤ 1_000_000 are
    // static fees in pips (1_000_000 = 100%). The flag 0x800000 marks the
    // pool as dynamic-fee — used by hook-based pools (e.g. VEILEDHOOD↔WETH).
    // Accept the full uint24 range; the V4 contract is the source of truth.
    fee:         z.number().int().min(0).max(0xFFFFFF),
    tickSpacing: z.number().int().min(1),
    hooks:       z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  }),
  toAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
});

export function createSwapsRouter(env: Env): Router {
  const router = Router();

  /**
   * POST /veilswap/deposits
   * Called by frontend after a successful on-chain deposit to VeilSwap.
   */
  router.post(
    "/veilswap/deposits",
    requireAuth(env),
    async (req: AuthedRequest, res): Promise<void> => {
      const parsed = swapDepositBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
        return;
      }

      const rpc = env.RPC_URL?.trim();
      const vault = env.VEILSWAP_ADDRESS?.trim();
      if (!rpc || !vault) {
        res.status(503).json({ error: "VeilSwap not configured on this server" });
        return;
      }

      const chainId = parsed.data.chainId ?? env.CHAIN_ID ?? 8453;
      const address = req.walletAddress!;

      try {
        const result = await recordSwapDeposit({
          rpcUrl: rpc,
          vaultAddress: vault,
          staticChainId: env.CHAIN_ID,
          address,
          txHash: parsed.data.txHash,
          chainId,
        });

        res
          .status(result.status === "created" ? 201 : 200)
          .json(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Internal error";
        res.status(400).json({ error: msg });
      }
    }
  );

  /**
   * POST /swaps
   * Initiates a shielded swap. Returns 202 immediately; client polls GET /swaps/:key.
   */
  router.post(
    "/swaps",
    requireAuth(env),
    async (req: AuthedRequest, res): Promise<void> => {
      const parsed = swapBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
        return;
      }

      const {
        idempotencyKey,
        tokenIn,
        tokenOut,
        amountIn,
        amountOutMin,
        poolKey,
        toAddress,
      } = parsed.data;

      const chainId = env.CHAIN_ID ?? 8453;
      const fromAddress = req.walletAddress!;
      const recipient = toAddress
        ? ethers.getAddress(toAddress.toLowerCase()).toLowerCase()
        : fromAddress;
      const tokenInAddr = ethers.getAddress(tokenIn.toLowerCase()).toLowerCase();
      const tokenOutAddr = ethers.getAddress(tokenOut.toLowerCase()).toLowerCase();

      if (tokenInAddr === tokenOutAddr) {
        res.status(400).json({ error: "tokenIn and tokenOut must differ" });
        return;
      }

      // Validate poolKey currencies match tokenIn/tokenOut
      const c0 = poolKey.currency0.toLowerCase();
      const c1 = poolKey.currency1.toLowerCase();
      if (c0 !== tokenInAddr && c1 !== tokenInAddr) {
        res.status(400).json({ error: "poolKey currencies do not include tokenIn" });
        return;
      }
      if (c0 !== tokenOutAddr && c1 !== tokenOutAddr) {
        res.status(400).json({ error: "poolKey currencies do not include tokenOut" });
        return;
      }

      // Validate caller has sufficient tokenIn balance
      const bal = await SwapUserBalance.findOne({
        address: fromAddress,
        chainId,
        tokenAddress: tokenInAddr,
      }).lean<{ totalAmount?: string } | null>();

      const available = BigInt(bal?.totalAmount ?? "0");
      if (available < BigInt(amountIn)) {
        res.status(400).json({
          error: "Insufficient VeilSwap balance",
          available: available.toString(),
          requested: amountIn,
        });
        return;
      }

      // Idempotency: if swap already exists, return it
      const existing = await Swap.findOne({ idempotencyKey })
        .select("status fromAddress swapTxHash adminWithdrawTxHash")
        .lean<{
          status?: string;
          fromAddress?: string;
          swapTxHash?: string;
          adminWithdrawTxHash?: string;
        } | null>();

      if (existing) {
        if (existing.fromAddress !== fromAddress) {
          res.status(403).json({ error: "idempotencyKey belongs to a different account" });
          return;
        }
        const needsPayout =
          !existing.adminWithdrawTxHash &&
          (existing.status === "failed" || existing.status === "swap_completed");
        if (needsPayout) {
          void executeSwap(env, idempotencyKey).catch((err: unknown) => {
            console.error(`[veilswap] executeSwap resume ${idempotencyKey} failed:`, err);
          });
        }
        res.status(202).json({ idempotencyKey, status: existing.status });
        return;
      }

      // Create swap record
      await Swap.create({
        idempotencyKey,
        fromAddress,
        toAddress: recipient,
        chainId,
        tokenIn: tokenInAddr,
        tokenOut: tokenOutAddr,
        amountIn,
        amountOutMin,
        poolKey: {
          currency0:   poolKey.currency0.toLowerCase(),
          currency1:   poolKey.currency1.toLowerCase(),
          fee:         poolKey.fee,
          tickSpacing: poolKey.tickSpacing,
          hooks:       poolKey.hooks.toLowerCase(),
        },
        status: "pending",
      });

      // Fire-and-forget — client polls for status
      void executeSwap(env, idempotencyKey).catch((err: unknown) => {
        console.error(`[veilswap] executeSwap ${idempotencyKey} failed:`, err);
      });

      res.status(202).json({ idempotencyKey, status: "pending" });
    }
  );

  /**
   * GET /swaps/:idempotencyKey
   * Poll for swap status and tx hashes.
   */
  router.get(
    "/swaps/:idempotencyKey",
    requireAuth(env),
    async (req: AuthedRequest, res): Promise<void> => {
      const key = req.params.idempotencyKey;
      if (!key || key.length < 8 || key.length > 128) {
        res.status(400).json({ error: "Invalid idempotencyKey" });
        return;
      }

      const swap = await Swap.findOne({ idempotencyKey: key })
        .select(
          "fromAddress toAddress chainId tokenIn tokenOut amountIn amountOut amountOutMin " +
          "merkleBeforeSwapTxHash swapTxHash merkleAfterSwapTxHash adminWithdrawTxHash " +
          "status payoutError createdAt updatedAt"
        )
        .lean<{
          fromAddress?: string;
          toAddress?: string;
          chainId?: number;
          tokenIn?: string;
          tokenOut?: string;
          amountIn?: string;
          amountOut?: string;
          amountOutMin?: string;
          merkleBeforeSwapTxHash?: string;
          swapTxHash?: string;
          merkleAfterSwapTxHash?: string;
          adminWithdrawTxHash?: string;
          status?: string;
          payoutError?: string;
          createdAt?: Date;
          updatedAt?: Date;
        } | null>();

      if (!swap) {
        res.status(404).json({ error: "Swap not found" });
        return;
      }

      if (swap.fromAddress !== req.walletAddress) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const shouldRetryPayout =
        !swap.adminWithdrawTxHash &&
        swap.swapTxHash &&
        (swap.status === "failed" || swap.status === "swap_completed") &&
        !payoutRetryInFlight.has(key);

      if (shouldRetryPayout) {
        payoutRetryInFlight.add(key);
        void resumeSwapIfNeeded(env, key)
          .catch((err: unknown) => {
            console.error(`[veilswap] payout retry ${key} failed:`, err);
          })
          .finally(() => {
            payoutRetryInFlight.delete(key);
          });
      }

      res.json({ idempotencyKey: key, ...swap });
    }
  );

  /** GET /veilswap/pairs — curated token pair list (no auth). */
  router.get("/veilswap/pairs", (_req, res): void => {
    res.json(VEILSWAP_PAIRS);
  });

  /** GET /veilswap/quote — live spot-price quote via V4 PoolManager storage (no auth). */
  router.get("/veilswap/quote", async (req, res): Promise<void> => {
    const tokenIn  = typeof req.query.tokenIn  === "string" ? req.query.tokenIn  : undefined;
    const tokenOut = typeof req.query.tokenOut === "string" ? req.query.tokenOut : undefined;
    const amountIn = typeof req.query.amountIn === "string" ? req.query.amountIn : undefined;

    if (
      !tokenIn  || !/^0x[a-fA-F0-9]{40}$/.test(tokenIn)  ||
      !tokenOut || !/^0x[a-fA-F0-9]{40}$/.test(tokenOut) ||
      !amountIn || !/^\d+$/.test(amountIn) || BigInt(amountIn) === 0n
    ) {
      res.status(400).json({ error: "tokenIn, tokenOut, amountIn are required" });
      return;
    }

    const rpc = env.RPC_URL?.trim();
    if (!rpc) {
      res.status(503).json({ error: "Quote service not configured (RPC_URL missing)" });
      return;
    }

    const pair = VEILSWAP_PAIRS.find(
      (p) => p.tokenIn.toLowerCase()  === tokenIn.toLowerCase() &&
             p.tokenOut.toLowerCase() === tokenOut.toLowerCase()
    );
    if (!pair) {
      res.status(400).json({ error: "Pair not supported" });
      return;
    }

    try {
      const provider = createJsonRpcProvider(rpc, env.CHAIN_ID);

      // Read sqrtPriceX96 from V4 PoolManager storage.
      // StateLibrary.sol: POOLS_SLOT = 6; pool state slot = keccak256(abi.encode(poolId, 6)).
      // Bottom 160 bits of that slot = sqrtPriceX96 (0 → pool not initialised).
      const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
      const POOLS_SLOT   = 6n;
      const { poolKey } = pair;

      const poolIdPreimage = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"],
        [
          ethers.getAddress(poolKey.currency0.toLowerCase()),
          ethers.getAddress(poolKey.currency1.toLowerCase()),
          poolKey.fee,
          poolKey.tickSpacing,
          ethers.getAddress(poolKey.hooks.toLowerCase()),
        ]
      );
      const poolId = ethers.keccak256(poolIdPreimage);

      const stateSlot = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "bytes32"],
          [poolId, ethers.zeroPadValue(ethers.toBeHex(POOLS_SLOT), 32)]
        )
      );
      const raw = await provider.getStorage(POOL_MANAGER, stateSlot);
      const sqrtP = BigInt(raw) & ((1n << 160n) - 1n);

      if (sqrtP === 0n) {
        res.status(400).json({ error: "V4 pool not initialised for this pair" });
        return;
      }

      // Spot price estimate (no price impact):
      //   zeroForOne: amountOut ≈ amountIn × sqrtP² / 2¹⁹² × (1 − fee/1e6)
      //   oneForZero: amountOut ≈ amountIn × 2¹⁹² / sqrtP² × (1 − fee/1e6)
      const Q192      = 2n ** 192n;
      const FEE_DENOM = 1_000_000n;
      const amtIn     = BigInt(amountIn);
      // For dynamic-fee pools (fee flag 0x800000 > FEE_DENOM), skip fee deduction.
      const rawFee = BigInt(poolKey.fee);
      const feeMul = rawFee < FEE_DENOM ? FEE_DENOM - rawFee : FEE_DENOM;
      const zeroForOne = poolKey.currency0.toLowerCase() === tokenIn.toLowerCase();

      let amountOut: bigint;
      if (zeroForOne) {
        amountOut = (amtIn * sqrtP * sqrtP * feeMul) / (Q192 * FEE_DENOM);
      } else {
        amountOut = (amtIn * Q192 * feeMul) / (sqrtP * sqrtP * FEE_DENOM);
      }

      res.json({ amountOut: amountOut.toString(), poolKey });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Quote failed";
      res.status(500).json({ error: msg });
    }
  });

  /** GET /veilswap/me — SwapUserBalance for the authenticated user. */
  router.get("/veilswap/me", requireAuth(env), async (req: AuthedRequest, res): Promise<void> => {
    const chainId = env.CHAIN_ID ?? 8453;
    const balances = await SwapUserBalance.find({
      address: req.walletAddress!,
      chainId,
    })
      .select("tokenAddress totalAmount chainId")
      .lean<{ tokenAddress: string; totalAmount: string; chainId: number }[]>();
    res.json({ balances });
  });

  /** GET /veilswap/activity — recent Swap records for the authenticated user. */
  router.get("/veilswap/activity", requireAuth(env), async (req: AuthedRequest, res): Promise<void> => {
    const items = await Swap.find({ fromAddress: req.walletAddress! })
      .sort({ createdAt: -1 })
      .limit(20)
      .select(
        "idempotencyKey tokenIn tokenOut amountIn amountOut status " +
        "swapTxHash adminWithdrawTxHash createdAt"
      )
      .lean();
    res.json({ items });
  });

  /** POST /veilswap/withdraw-signature — Merkle proof + EIP-712 sig for self-withdraw. */
  router.post(
    "/veilswap/withdraw-signature",
    requireAuth(env),
    async (req: AuthedRequest, res): Promise<void> => {
      const parsed = z.object({
        tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        chainId: z.coerce.number().int().positive().optional(),
      }).safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
        return;
      }

      const rpc = env.RPC_URL?.trim();
      const vault = env.VEILSWAP_ADDRESS?.trim();
      const signerPk = env.SIGNER_PRIVATE_KEY?.trim();
      if (!rpc || !vault || !signerPk) {
        res.status(503).json({ error: "VeilSwap not configured" });
        return;
      }

      const chainId = parsed.data.chainId ?? env.CHAIN_ID ?? 8453;
      const address = req.walletAddress!;
      const tokenAddress = parsed.data.tokenAddress.toLowerCase();

      const bal = await SwapUserBalance.findOne({
        address,
        chainId,
        tokenAddress,
      }).lean<{ totalAmount?: string } | null>();

      const balance = BigInt(bal?.totalAmount ?? "0");
      if (balance === 0n) {
        res.status(400).json({ error: "No VeilSwap balance for this token" });
        return;
      }

      const rows = await SwapUserBalance.find({ chainId }).lean<
        { address: string; tokenAddress: string; totalAmount: string }[]
      >();

      let tree: Awaited<ReturnType<typeof buildSwapMerkleTree>>;
      try {
        tree = await buildSwapMerkleTree(rows);
      } catch {
        res.status(500).json({ error: "Failed to build Merkle tree" });
        return;
      }

      const token = ethers.getAddress(tokenAddress);
      const proof = getProofForLeaf(tree, ethers.getAddress(address), token, balance);

      const provider = createJsonRpcProvider(rpc, env.CHAIN_ID);
      const network = await provider.getNetwork();
      const wallet = new ethers.Wallet(signerPk, provider);

      const deadline = BigInt(Math.floor(Date.now() / 1000)) + BigInt(env.WITHDRAW_DEADLINE_MAX_SEC);
      const merkleRoot = tree.root;
      const nullifier = withdrawNullifier(merkleRoot, ethers.getAddress(address), token, balance);
      const vaultAddress = ethers.getAddress(vault);

      const domain = {
        name: "VeilSwap",
        version: "1",
        chainId: network.chainId,
        verifyingContract: vaultAddress,
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
        user: ethers.getAddress(address),
        token,
        balance,
        nullifier,
        deadline,
      };

      const signature = await wallet.signTypedData(domain, types, message);

      // Commit current Merkle root to contract so the proof is valid on-chain
      const onChain = (await new ethers.Contract(vaultAddress, VEILSWAP_ABI, provider).getMerkleRoot()) as string;
      if (onChain.toLowerCase() !== merkleRoot.toLowerCase()) {
        const adminPk = env.ADMIN_PRIVATE_KEY?.trim();
        if (adminPk) {
          const { sendDeployerContractTx } = await import("../services/deployerTxQueue.js");
          await sendDeployerContractTx({
            rpcUrl: rpc,
            privateKey: adminPk,
            staticChainId: env.CHAIN_ID,
            send: async (w, nonce) => {
              const c = new ethers.Contract(vaultAddress, VEILSWAP_ABI, w);
              return c.updateMerkleRoot(merkleRoot, { nonce });
            },
          });
        }
      }

      res.json({
        proof,
        signature,
        deadline: deadline.toString(),
        nullifier,
        merkleRoot,
        balance: balance.toString(),
        verifyingContract: vaultAddress,
      });
    }
  );

  /** POST /veilswap/record-withdraw — record completed on-chain self-withdraw, zero balance. */
  router.post(
    "/veilswap/record-withdraw",
    requireAuth(env),
    async (req: AuthedRequest, res): Promise<void> => {
      const parsed = z.object({
        txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
        tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        amount: z.string().regex(/^\d+$/),
        chainId: z.coerce.number().int().positive().optional(),
      }).safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
        return;
      }

      const rpc = env.RPC_URL?.trim();
      const vault = env.VEILSWAP_ADDRESS?.trim();
      if (!rpc || !vault) {
        res.status(503).json({ error: "VeilSwap not configured" });
        return;
      }

      const chainId = parsed.data.chainId ?? env.CHAIN_ID ?? 8453;
      const address = req.walletAddress!;
      const tokenAddress = parsed.data.tokenAddress.toLowerCase();
      const txHash = parsed.data.txHash.toLowerCase();

      // Validate on-chain: receipt must include a VeilSwap withdrawal for this user.
      const provider = createJsonRpcProvider(rpc, env.CHAIN_ID);
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt || receipt.status !== 1) {
        res.status(400).json({ error: "Transaction not found or reverted" });
        return;
      }

      const iface = new ethers.Interface([...VEILSWAP_ABI]);
      const vaultLower = vault.toLowerCase();
      const userLower = address.toLowerCase();
      let confirmed = false;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== vaultLower) continue;
        try {
          const parsedLog = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (
            parsedLog?.name === "UserWithdrawal" ||
            parsedLog?.name === "AdminWithdrawal"
          ) {
            const eventUser = String(parsedLog.args.user).toLowerCase();
            if (eventUser === userLower) {
              confirmed = true;
              break;
            }
          }
        } catch { /* not a VeilSwap log */ }
      }

      if (!confirmed) {
        res.status(400).json({
          error: "No VeilSwap withdrawal event for this wallet found in transaction",
        });
        return;
      }

      await SwapUserBalance.findOneAndUpdate(
        { address, chainId, tokenAddress },
        { $set: { totalAmount: "0" } }
      );

      res.status(201).json({ status: "created" });
    }
  );

  return router;
}
