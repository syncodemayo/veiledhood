import { ethers } from "ethers";
import type { Env } from "../config/env.js";
import { createJsonRpcProvider } from "../util/jsonRpcProvider.js";

const WITHDRAW_AUTH_TYPES: Record<
  string,
  Array<{ name: string; type: string }>
> = {
  WithdrawAuth: [
    { name: "user", type: "address" },
    { name: "token", type: "address" },
    { name: "balance", type: "uint256" },
    { name: "nullifier", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
};

export function withdrawNullifier(
  merkleRoot: string,
  user: string,
  token: string,
  balance: bigint
): string {
  const enc = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "address", "address", "uint256"],
    [
      merkleRoot,
      ethers.getAddress(user),
      ethers.getAddress(token),
      balance,
    ]
  );
  return ethers.keccak256(enc);
}

export type VeiledhoodWithdrawAuthPayload = {
  signature: string;
  /** Unix seconds as decimal string (JSON-safe). */
  deadline: string;
  nullifier: string;
  chainId: string;
  verifyingContract: string;
  domain: {
    name: string;
    version: string;
    chainId: string;
    verifyingContract: string;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  message: {
    user: string;
    token: string;
    balance: string;
    nullifier: string;
    deadline: string;
  };
};

/**
 * EIP-712 `WithdrawAuth` for Veiledhood — signed by `SIGNER_PRIVATE_KEY` (must match `_withdrawSigner` on-chain).
 */
export async function signVeiledhoodWithdrawAuth(params: {
  env: Env;
  merkleRoot: string;
  user: string;
  token: string;
  balance: bigint;
  deadline: bigint;
}): Promise<VeiledhoodWithdrawAuthPayload> {
  const { env, merkleRoot, user, token, balance, deadline } = params;
  if (!env.SIGNER_PRIVATE_KEY?.trim()) {
    throw new Error("SIGNER_PRIVATE_KEY is not configured");
  }
  if (!env.RPC_URL?.trim()) {
    throw new Error("RPC_URL is not configured");
  }
  if (!env.VAULT_ADDRESS?.trim()) {
    throw new Error("VAULT_ADDRESS is not configured");
  }
  if (balance <= 0n) {
    throw new Error("balance must be positive");
  }

  const provider = createJsonRpcProvider(env.RPC_URL.trim(), env.CHAIN_ID);
  const network = await provider.getNetwork();
  const chainId = network.chainId;
  const vaultAddress = ethers.getAddress(env.VAULT_ADDRESS.trim());
  const u = ethers.getAddress(user);
  const t = ethers.getAddress(token);
  const nullifier = withdrawNullifier(merkleRoot, u, t, balance);

  const wallet = new ethers.Wallet(env.SIGNER_PRIVATE_KEY.trim(), provider);

  const domain = {
    name: "Veiledhood",
    version: "1",
    chainId,
    verifyingContract: vaultAddress,
  };

  const message = {
    user: u,
    token: t,
    balance,
    nullifier,
    deadline,
  };

  const signature = await wallet.signTypedData(
    domain,
    WITHDRAW_AUTH_TYPES,
    message
  );

  return {
    signature,
    deadline: deadline.toString(),
    nullifier,
    chainId: chainId.toString(),
    verifyingContract: vaultAddress,
    domain: {
      name: domain.name,
      version: domain.version,
      chainId: chainId.toString(),
      verifyingContract: vaultAddress,
    },
    types: WITHDRAW_AUTH_TYPES,
    message: {
      user: u,
      token: t,
      balance: balance.toString(),
      nullifier,
      deadline: deadline.toString(),
    },
  };
}
