import { ethers } from "ethers";
import { createJsonRpcProvider } from "../util/jsonRpcProvider.js";

/**
 * Serialize every deployer broadcast. Inside the lock we:
 * 1. Read `eth_getTransactionCount(address, "pending")` and pass that nonce explicitly.
 * 2. Broadcast and wait for a mined receipt before the next job runs.
 * 3. Retry a few times on nonce / replacement errors (RPC lag or rare races).
 *
 * ETH and USDC payouts share this path; same deployer EOA must never interleave txs.
 * Multiple API replicas with the same key still need one worker or an external lock.
 */
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(() => fn());
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function isNonceOrTxPoolConflict(err: unknown): boolean {
  const s = err instanceof Error ? err.message : String(err);
  return /nonce too low|NONCE_EXPIRED|nonce has already been used|replacement fee too low|already known/i.test(
    s
  );
}

const NONCE_RETRY_ATTEMPTS = 5;
const NONCE_RETRY_BASE_MS = 250;

export async function sendDeployerContractTx(params: {
  rpcUrl: string;
  privateKey: string;
  /** When set (e.g. `env.CHAIN_ID`), uses static network to avoid flaky `eth_chainId` detection. */
  staticChainId?: number;
  send: (
    wallet: ethers.Wallet,
    nonce: number
  ) => Promise<ethers.ContractTransactionResponse>;
}): Promise<ethers.ContractTransactionReceipt> {
  const { rpcUrl, privateKey, staticChainId, send } = params;
  return enqueue(async () => {
    const provider = createJsonRpcProvider(rpcUrl, staticChainId);
    const wallet = new ethers.Wallet(privateKey, provider);

    let lastErr: unknown;
    for (let attempt = 0; attempt < NONCE_RETRY_ATTEMPTS; attempt++) {
      try {
        const nonce = await provider.getTransactionCount(
          wallet.address,
          "pending"
        );
        const tx = await send(wallet, nonce);
        const receipt = await tx.wait();
        if (receipt == null) {
          throw new Error("Deployer transaction receipt missing");
        }
        if (receipt.status !== 1) {
          throw new Error(`Deployer transaction reverted (hash=${receipt.hash})`);
        }
        return receipt;
      } catch (e) {
        lastErr = e;
        const retry =
          isNonceOrTxPoolConflict(e) && attempt < NONCE_RETRY_ATTEMPTS - 1;
        if (!retry) {
          throw e;
        }
        await new Promise((r) =>
          setTimeout(r, NONCE_RETRY_BASE_MS + attempt * 150)
        );
      }
    }
    throw lastErr;
  });
}
