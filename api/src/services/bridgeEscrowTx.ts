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

/** Approve `spender` to pull `amount` of an ERC-20 from an escrow wallet. */
export async function approveErc20FromEscrow(params: {
  rpcUrl: string;
  staticChainId?: number;
  escrowWallet: ethers.HDNodeWallet;
  token: string;
  spender: string;
  amount: bigint;
}): Promise<{ txHash: string }> {
  const { rpcUrl, staticChainId, escrowWallet, token, spender, amount } = params;
  const provider = createJsonRpcProvider(rpcUrl, staticChainId);
  const wallet = escrowWallet.connect(provider);
  const erc20 = new ethers.Contract(
    ethers.getAddress(token),
    ["function approve(address,uint256) returns (bool)"],
    wallet
  );
  const tx = await erc20.approve(ethers.getAddress(spender), amount);
  const receipt = await tx.wait(1);
  if (!receipt) throw new Error("approve receipt missing");
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
