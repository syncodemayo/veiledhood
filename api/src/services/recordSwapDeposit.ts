import { ethers } from "ethers";
import { SwapDeposit } from "../models/SwapDeposit.js";
import { SwapUserBalance } from "../models/SwapUserBalance.js";
import { VEILSWAP_ABI } from "../abi/veilSwap.js";

export type RecordSwapDepositResult =
  | { status: "created"; depositId: string }
  | { status: "duplicate" };

/**
 * Record a VeilSwap deposit that was already confirmed on-chain.
 * Validates the tx receipt, upserts SwapDeposit, and credits SwapUserBalance.
 */
export async function recordSwapDeposit(params: {
  rpcUrl: string;
  vaultAddress: string;
  staticChainId?: number;
  address: string;
  txHash: string;
  chainId: number;
}): Promise<RecordSwapDepositResult> {
  const { rpcUrl, vaultAddress, staticChainId, address, txHash, chainId } =
    params;

  const provider = new ethers.JsonRpcProvider(rpcUrl, staticChainId, {
    staticNetwork: staticChainId != null,
  });

  // Defense-in-depth against a frontend racing the chain: clients have been
  // observed POSTing the txHash 2-3s before the block lands, which makes
  // `getTransactionReceipt` return null on the first try. Retry briefly so a
  // single propagation lag doesn't strand the deposit ledger-side.
  const RECEIPT_RETRY_ATTEMPTS = 6;
  const RECEIPT_RETRY_DELAY_MS = 2000;
  let receipt: ethers.TransactionReceipt | null = null;
  for (let attempt = 0; attempt < RECEIPT_RETRY_ATTEMPTS; attempt++) {
    receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) break;
    if (attempt < RECEIPT_RETRY_ATTEMPTS - 1) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, RECEIPT_RETRY_DELAY_MS)
      );
    }
  }
  if (!receipt) {
    const totalWaitSec =
      (RECEIPT_RETRY_ATTEMPTS * RECEIPT_RETRY_DELAY_MS) / 1000;
    throw new Error(
      `Transaction ${txHash} not found after ${totalWaitSec}s of retry`
    );
  }
  if (receipt.status !== 1) {
    throw new Error(`Transaction ${txHash} reverted`);
  }

  const iface = new ethers.Interface([...VEILSWAP_ABI]);
  const vault = ethers.getAddress(vaultAddress);

  let token: string | undefined;
  let amount: bigint | undefined;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== vault.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "Deposited") {
        token = (parsed.args.token as string).toLowerCase();
        amount = parsed.args.amount as bigint;
        break;
      }
    } catch {
      // not a VeilSwap log
    }
  }

  if (!token || amount === undefined) {
    throw new Error(
      `No Deposited event from VeilSwap vault in tx ${txHash}`
    );
  }

  const tokenAddress = token.toLowerCase();
  const amountStr = amount.toString();
  const depositor = address.toLowerCase();

  try {
    const doc = await SwapDeposit.create({
      address: depositor,
      chainId,
      token: tokenAddress,
      amount: amountStr,
      txHash: txHash.toLowerCase(),
    });

    const prev = await SwapUserBalance.findOne({
      address: depositor,
      chainId,
      tokenAddress,
    }).lean<{ totalAmount?: string } | null>();
    const prevAmount = BigInt(prev?.totalAmount ?? "0");
    const nextAmount = (prevAmount + amount).toString();

    await SwapUserBalance.findOneAndUpdate(
      { address: depositor, chainId, tokenAddress },
      {
        $set: {
          address: depositor,
          chainId,
          tokenAddress,
          totalAmount: nextAmount,
        },
      },
      { upsert: true }
    );

    return { status: "created", depositId: doc._id.toString() };
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: number }).code === 11000
    ) {
      return { status: "duplicate" };
    }
    throw e;
  }
}
