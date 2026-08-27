import { ethers } from "ethers";
import { UserBalance } from "../models/UserBalance.js";
import { Deposit } from "../models/Deposit.js";
import { Bridge } from "../models/Bridge.js";
import { IndexerState } from "../models/IndexerState.js";
import { VEILEDHOOD_ABI } from "../abi/veiledhood.js";
import { NATIVE_CURRENCY_KEY } from "../constants/currency.js";
import { commitMerkleRootFromDb } from "./veiledhoodAdmin.js";
import type { Env } from "../config/env.js";
import { buildAssetKey, DEFAULT_BASE_CHAIN_ID } from "../util/chainLedger.js";
import { normalizeLedgerCurrency } from "../util/ledgerCurrency.js";

const INDEXER_KEY = "deposited";

function tokenToCurrencyKey(token: string): string {
  const t = token.toLowerCase();
  if (t === ethers.ZeroAddress.toLowerCase()) {
    return NATIVE_CURRENCY_KEY;
  }
  return ethers.getAddress(token);
}

/**
 * A bridge escrow deposits the bridged funds into the destination vault as part
 * of the bridge flow. The bridge orchestrator credits the USER's shielded leaf
 * directly (creditDestShielded), so the indexer must NOT also credit the escrow
 * — that would double-count the ledger against a single deposit of reserves.
 */
export async function isBridgeEscrowAddress(address: string): Promise<boolean> {
  const lc = address.toLowerCase();
  const hit = await Bridge.exists({
    $or: [{ destEscrowAddress: lc }, { sourceEscrowAddress: lc }],
  });
  return hit != null;
}

export async function applyDepositedLog(
  depositor: string,
  token: string,
  amount: bigint,
  chainId: number,
  txHash: string,
): Promise<void> {
  const address = depositor.toLowerCase();

  // Skip bridge-escrow deposits — the bridge credits the user itself.
  if (await isBridgeEscrowAddress(address)) {
    return;
  }

  const currency = normalizeLedgerCurrency(tokenToCurrencyKey(token));
  const assetKey = buildAssetKey(chainId, currency);

  // Dedupe FIRST: insert the Deposit row and only mutate UserBalance on a
  // genuine first insert. The previous order (balance bump → Deposit.create)
  // double-counted deposits that were already recorded via the
  // POST /eth/deposits frontend path, because the duplicate-key catch ran
  // *after* the balance had already been incremented.
  try {
    await Deposit.create({ address, chainId, assetKey, currency, amount: amount.toString(), txHash });
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: number }).code === 11000) {
      return; // already processed, no balance update
    }
    throw e;
  }

  const doc = await UserBalance.findOne({ address, chainId, assetKey });
  const prev = doc && /^\d+$/.test(doc.totalAmount) ? BigInt(doc.totalAmount) : 0n;
  const next = prev + amount;
  await UserBalance.findOneAndUpdate(
    { address, chainId, assetKey },
    { $set: { address, chainId, assetKey, currency, totalAmount: next.toString() } },
    { upsert: true }
  );
}

/**
 * Scan `Deposited` logs, update `UserBalance`, advance cursor, then commit Merkle root if anything new.
 */
export async function runDepositIndexerSync(env: Env): Promise<{
  processed: number;
  merkleTxHash?: string;
  merkleSkipped?: boolean;
}> {
  const rpc = env.RPC_URL?.trim();
  const vault = env.VAULT_ADDRESS?.trim();
  const adminPk = env.ADMIN_PRIVATE_KEY?.trim();
  if (!rpc || !vault || !adminPk) {
    return { processed: 0 };
  }

  const fromBlockEnv = env.MERKLE_INDEXER_FROM_BLOCK ?? 0;
  let state = await IndexerState.findOne({ key: INDEXER_KEY });
  if (!state) {
    state = await IndexerState.create({
      key: INDEXER_KEY,
      lastBlock: Math.max(0, fromBlockEnv - 1),
    });
  }

  const provider = new ethers.JsonRpcProvider(rpc, env.CHAIN_ID, {
    staticNetwork: env.CHAIN_ID != null,
  });
  const latest = await provider.getBlockNumber();
  let cursor = state.lastBlock;
  const contract = new ethers.Contract(vault, VEILEDHOOD_ABI, provider);
  let processed = 0;
  const chunkBlocks = Math.max(1, env.INDEXER_LOG_CHUNK_BLOCKS ?? 10);

  while (cursor < latest) {
    const from = cursor + 1;
    const to = Math.min(from + chunkBlocks - 1, latest);
    const filter = contract.filters.Deposited();
    const logs = await contract.queryFilter(filter, from, to);
    for (const log of logs) {
      const parsed = contract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (!parsed || parsed.name !== "Deposited") continue;
      const depositor = (parsed.args.depositor as string).toLowerCase();
      const token = parsed.args.token as string;
      const amount = parsed.args.amount as bigint;
      const txHash = (log as ethers.Log).transactionHash;
      await applyDepositedLog(depositor, token, amount, env.CHAIN_ID ?? DEFAULT_BASE_CHAIN_ID, txHash);
      processed += 1;
    }
    cursor = to;
    await IndexerState.updateOne(
      { key: INDEXER_KEY },
      { $set: { lastBlock: to } }
    );
  }

  let merkleTxHash: string | undefined;
  let merkleSkipped: boolean | undefined;
  if (processed > 0) {
    const r = await commitMerkleRootFromDb({
      rpcUrl: rpc,
      vaultAddress: ethers.getAddress(vault),
      adminPrivateKey: adminPk,
      staticChainId: env.CHAIN_ID,
    });
    merkleSkipped = r.skipped;
    if (r.txHash) merkleTxHash = r.txHash;
  }

  return { processed, merkleTxHash, merkleSkipped };
}

export type DepositIndexerHandle = {
  stop: () => void;
};

/**
 * Startup catch-up sync + live `Deposited` listener.
 * Listener path still re-runs sync to stay cursor-safe and restart-safe.
 */
export async function startDepositIndexer(env: Env): Promise<DepositIndexerHandle> {
  const rpc = env.RPC_URL?.trim();
  const vault = env.VAULT_ADDRESS?.trim();
  const adminPk = env.ADMIN_PRIVATE_KEY?.trim();
  if (!rpc || !vault || !adminPk) {
    return { stop: () => undefined };
  }

  const provider = new ethers.JsonRpcProvider(rpc, env.CHAIN_ID, {
    staticNetwork: env.CHAIN_ID != null,
  });
  const contract = new ethers.Contract(vault, VEILEDHOOD_ABI, provider);
  const filter = contract.filters.Deposited();

  // Live-only mode: process only new events while the listener is running.
  let running = false;
  const queue: Array<{
    depositor: string;
    token: string;
    amount: bigint;
    blockNumber?: number;
    txHash?: string;
  }> = [];

  const decodeDepositedArgs = (args: unknown[]): {
    depositor: string;
    token: string;
    amount: bigint;
    blockNumber?: number;
    txHash?: string;
  } | null => {
    const last = args.at(-1) as
      | ethers.EventLog
      | { log?: ethers.EventLog; args?: unknown }
      | undefined;
    const eventLog =
      last && typeof last === "object" && "log" in last
        ? (last.log as ethers.EventLog | undefined)
        : (last as ethers.EventLog | undefined);

    let depositor: string | undefined;
    let token: string | undefined;
    let amount: bigint | undefined;

    if (
      typeof args[0] === "string" &&
      typeof args[1] === "string" &&
      typeof args[2] === "bigint"
    ) {
      depositor = args[0];
      token = args[1];
      amount = args[2];
    } else {
      const maybeDecoded =
        args[0] && typeof args[0] === "object"
          ? (args[0] as { depositor?: unknown; token?: unknown; amount?: unknown })
          : null;
      if (
        maybeDecoded &&
        typeof maybeDecoded.depositor === "string" &&
        typeof maybeDecoded.token === "string" &&
        typeof maybeDecoded.amount === "bigint"
      ) {
        depositor = maybeDecoded.depositor;
        token = maybeDecoded.token;
        amount = maybeDecoded.amount;
      }
    }

    if ((!depositor || !token || amount === undefined) && eventLog) {
      try {
        const parsed = contract.interface.parseLog({
          topics: eventLog.topics as string[],
          data: eventLog.data,
        });
        if (parsed && parsed.name === "Deposited") {
          depositor = parsed.args.depositor as string;
          token = parsed.args.token as string;
          amount = parsed.args.amount as bigint;
        }
      } catch {
        // Ignore malformed/non-matching logs.
      }
    }

    if (!depositor || !token || amount === undefined) return null;
    return {
      depositor,
      token,
      amount,
      blockNumber: eventLog?.blockNumber,
      txHash: eventLog?.transactionHash,
    };
  };

  const processQueue = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) continue;
        await applyDepositedLog(
          item.depositor,
          item.token,
          item.amount,
          env.CHAIN_ID ?? DEFAULT_BASE_CHAIN_ID,
          item.txHash ?? ethers.hexlify(ethers.randomBytes(32)),
        );
        if (typeof item.blockNumber === "number") {
          await IndexerState.findOneAndUpdate(
            { key: INDEXER_KEY },
            { $max: { lastBlock: item.blockNumber } },
            { upsert: true, setDefaultsOnInsert: true }
          );
        }
        await commitMerkleRootFromDb({
          rpcUrl: rpc,
          vaultAddress: ethers.getAddress(vault),
          adminPrivateKey: adminPk,
          staticChainId: env.CHAIN_ID,
        });
      }
    } catch (e) {
      console.error("[depositIndexer]", e);
    } finally {
      running = false;
      // If events were queued while finishing, immediately continue.
      if (queue.length > 0) void processQueue();
    }
  };

  const onDeposited = (...args: unknown[]) => {
    const decoded = decodeDepositedArgs(args);
    if (!decoded) {
      console.warn("[depositIndexer] Could not decode Deposited event args");
      return;
    }
    queue.push(decoded);
    void processQueue();
  };
  contract.on(filter, onDeposited);

  return {
    stop: () => {
      contract.off(filter, onDeposited);
      provider.destroy();
    },
  };
}
