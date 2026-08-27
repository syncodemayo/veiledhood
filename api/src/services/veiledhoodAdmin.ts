import { ethers } from "ethers";
import { UserBalance } from "../models/UserBalance.js";
import { VEILEDHOOD_ABI } from "../abi/veiledhood.js";
import { buildMerkleTree } from "./merkleTree.js";
import { userBalancesToMerkleLeaves } from "./ledgerLeaves.js";
import { sendDeployerContractTx } from "./deployerTxQueue.js";
import { DEFAULT_BASE_CHAIN_ID } from "../util/chainLedger.js";

export function veiledhoodInterface(): ethers.Interface {
  return new ethers.Interface([...VEILEDHOOD_ABI]);
}

export async function readMerkleRoot(
  rpcUrl: string,
  vaultAddress: string,
  staticChainId?: number
): Promise<string> {
  const provider = new ethers.JsonRpcProvider(rpcUrl, staticChainId, {
    staticNetwork: staticChainId != null,
  });
  const c = new ethers.Contract(vaultAddress, VEILEDHOOD_ABI, provider);
  return (await c.getMerkleRoot()) as string;
}

/**
 * Rebuild Merkle tree from all positive `UserBalance` rows and, if root changed, `updateMerkleRoot`.
 * Returns `{ root, txHash? }`.
 */
export async function commitMerkleRootFromDb(params: {
  rpcUrl: string;
  vaultAddress: string;
  adminPrivateKey: string;
  staticChainId?: number;
}): Promise<{ root: string; txHash?: string; skipped: boolean }> {
  const { rpcUrl, vaultAddress, adminPrivateKey, staticChainId } = params;
  const chainId = staticChainId ?? DEFAULT_BASE_CHAIN_ID;
  const rows = await UserBalance.find({ chainId }).lean<
    { address: string; currency: string; totalAmount: string }[]
  >();
  const leaves = userBalancesToMerkleLeaves(rows);
  const onChain = await readMerkleRoot(rpcUrl, vaultAddress, staticChainId);
  if (leaves.length === 0) {
    // Nobody has a positive shielded balance for this chain (e.g. the last
    // holder just fully drained via transfer/withdraw). There's no tree to
    // build — StandardMerkleTree requires >=1 leaf — and nothing to prove
    // against on-chain, so leave the existing root as-is rather than erroring.
    return { root: onChain, skipped: true };
  }
  const newRoot = buildMerkleTree(leaves).root;
  if (onChain.toLowerCase() === newRoot.toLowerCase()) {
    return { root: newRoot, skipped: true };
  }
  const iface = veiledhoodInterface();
  const receipt = await sendDeployerContractTx({
    rpcUrl,
    privateKey: adminPrivateKey,
    staticChainId,
    send: async (wallet, nonce) => {
      const c = new ethers.Contract(vaultAddress, VEILEDHOOD_ABI, wallet);
      return c.updateMerkleRoot(newRoot, { nonce });
    },
  });
  return { root: newRoot, txHash: receipt.hash, skipped: false };
}

export async function submitAdminWithdraw(params: {
  rpcUrl: string;
  vaultAddress: string;
  adminPrivateKey: string;
  staticChainId?: number;
  user: string;
  token: string;
  balance: bigint;
  proof: string[];
  deadline: bigint;
  signature: string;
}): Promise<{ txHash: string }> {
  const {
    rpcUrl,
    vaultAddress,
    adminPrivateKey,
    staticChainId,
    user,
    token,
    balance,
    proof,
    deadline,
    signature,
  } = params;
  const receipt = await sendDeployerContractTx({
    rpcUrl,
    privateKey: adminPrivateKey,
    staticChainId,
    send: async (wallet, nonce) => {
      const c = new ethers.Contract(vaultAddress, VEILEDHOOD_ABI, wallet);
      return c.adminWithdraw(
        ethers.getAddress(user),
        ethers.getAddress(token),
        balance,
        proof,
        deadline,
        signature,
        { nonce }
      );
    },
  });
  return { txHash: receipt.hash };
}
