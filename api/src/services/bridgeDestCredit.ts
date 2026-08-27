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
