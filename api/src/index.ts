import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { loadEnv } from "./config/env.js";
import { createJsonRpcProvider } from "./util/jsonRpcProvider.js";
import healthRouter from "./routes/health.js";
import { createAuthRouter } from "./routes/auth.js";
import { createUserRouter } from "./routes/user.js";
import { createTransfersRouter } from "./routes/transfers.js";
import { createWithdrawsRouter } from "./routes/withdraws.js";
import { createAiRouter } from "./routes/ai.js";
import { createAiHealthRouter } from "./routes/aiHealth.js";
import { createSwapsRouter } from "./routes/swaps.js";
import { createAgentsRouter } from "./routes/agents.js";
import { createContextRouter } from "./routes/context.js";
import { createContextHealthRouter } from "./routes/contextHealth.js";
import { createBridgeRouter } from "./routes/bridge.js";
import { createX402DiscoveryRouter } from "./routes/x402Discovery.js";
import { startDepositIndexer } from "./services/depositIndexer.js";
import { resumeTransferMerklePayoutIfNeeded } from "./services/transferMerklePayout.js";
import { resumeIncompleteBridges } from "./services/bridgeOrchestrator.js";
import { makeBridgeExecutor } from "./services/bridgeExecutor.js";
import { Transfer } from "./models/Transfer.js";

const env = loadEnv();

const app = express();

app.use(
  cors({
    origin: env.CORS_ORIGIN
      ? env.CORS_ORIGIN.split(",").map((o) => o.trim())
      : true,
  })
);
// 2mb leaves comfortable margin above DATA_MAX_CIPHERTEXT_BYTES (default 1mb)
// so oversized data-blob requests hit the route's typed 413 instead of
// express's opaque body-parser 413.
app.use(express.json({ limit: "2mb" }));

app.use(healthRouter);
app.use(createAuthRouter(env));
app.use(createUserRouter(env));
app.use(createTransfersRouter(env));
app.use(createWithdrawsRouter(env));
app.use(createAiRouter(env));
app.use(createAiHealthRouter(env));
app.use(createSwapsRouter(env));
app.use(createAgentsRouter(env));
app.use(createContextRouter(env));
app.use(createContextHealthRouter(env));
app.use(createBridgeRouter(env));
app.use(createX402DiscoveryRouter(env));

try {
  await mongoose.connect(env.MONGODB_URI);
} catch (err) {
  console.error(err);
  process.exit(1);
}

const rpcUrl = env.RPC_URL?.trim();
if (rpcUrl) {
  try {
    const provider = createJsonRpcProvider(rpcUrl, env.CHAIN_ID);
    const net = await provider.getNetwork();
    const chainId = Number(net.chainId);
    console.log(`[veiledhood-api] RPC chainId: ${chainId}`);
    if (env.CHAIN_ID !== undefined && chainId !== env.CHAIN_ID) {
      console.warn(
        `[veiledhood-api] CHAIN_ID (${env.CHAIN_ID}) ≠ RPC chainId (${chainId}); verify RPC_URL matches your deployment.`
      );
    }
  } catch (e) {
    console.warn("[veiledhood-api] Could not read RPC chainId:", e);
  }
}

if (env.INDEXER_DISABLED) {
  console.log(
    "[veiledhood-api] INDEXER_DISABLED=true — skipping deposit indexer + transfer resume (read-only API mode)"
  );
} else {
  if (
    env.RPC_URL?.trim() &&
    env.VAULT_ADDRESS?.trim() &&
    env.ADMIN_PRIVATE_KEY?.trim()
  ) {
    void startDepositIndexer(env)
      .then(() => {
        console.log(
          "[veiledhood-api] Deposit indexer started (startup sync + live Deposited listener)"
        );
      })
      .catch((e) => {
        console.error("[veiledhood-api] Failed to start deposit indexer:", e);
      });
  }

  if (
    env.RPC_URL?.trim() &&
    env.VAULT_ADDRESS?.trim() &&
    env.ADMIN_PRIVATE_KEY?.trim() &&
    env.SIGNER_PRIVATE_KEY?.trim()
  ) {
    void resumeIncompleteTransfers(env).catch((e) => {
      console.error("[veiledhood-api] Failed to resume incomplete transfers:", e);
    });
    if (env.BRIDGE_ENABLED) {
      void resumeIncompleteBridges(() => makeBridgeExecutor(env)).catch((e) => {
        console.error("[veiledhood-api] Failed to resume incomplete bridges:", e);
      });
    }
  }
}

async function resumeIncompleteTransfers(env: ReturnType<typeof loadEnv>): Promise<void> {
  const stuck = await Transfer.find({
    adminWithdrawTxHash: { $in: [null, undefined] },
  })
    .select("idempotencyKey chainId")
    .lean<{ idempotencyKey: string; chainId?: number }[]>();

  if (stuck.length === 0) return;

  const baseChainId = env.CHAIN_ID ?? env.BASE_CHAIN_ID ?? 8453;
  const ethChainId = env.ETH_CHAIN_ID ?? 1;

  console.log(`[veiledhood-api] Resuming ${stuck.length} incomplete transfer(s)…`);
  for (const t of stuck) {
    const isEth = t.chainId === ethChainId;
    if (isEth) {
      if (!env.ETH_RPC_URL?.trim() || !env.ETH_VAULT_ADDRESS?.trim()) {
        console.warn(
          `[veiledhood-api] Skipping ETH resume for ${t.idempotencyKey}: ETH_RPC_URL/ETH_VAULT_ADDRESS not configured`
        );
        continue;
      }
    }
    const useEnv = isEth
      ? {
          ...env,
          RPC_URL: env.ETH_RPC_URL!.trim(),
          VAULT_ADDRESS: env.ETH_VAULT_ADDRESS!,
          CHAIN_ID: ethChainId,
        }
      : { ...env, CHAIN_ID: baseChainId };
    try {
      const result = await resumeTransferMerklePayoutIfNeeded(useEnv, t.idempotencyKey);
      if (result) {
        console.log(
          `[veiledhood-api] Transfer ${t.idempotencyKey} (chainId=${t.chainId ?? baseChainId}) resumed: payout ${result.adminWithdrawTxHash}`
        );
      }
    } catch (e) {
      console.error(`[veiledhood-api] Failed to resume transfer ${t.idempotencyKey}:`, e);
    }
  }
}

app.listen(env.PORT, () => {
  console.log(`veiledhood-api listening on port ${env.PORT}`);
});
