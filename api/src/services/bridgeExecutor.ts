import { ethers } from "ethers";
import type { Env } from "../config/env.js";
import type { IBridge } from "../models/Bridge.js";
import type { BridgeExecutor } from "./bridgeOrchestrator.js";
import { bridgeChainEnv } from "./bridgeChainEnv.js";
import {
  deriveEscrowWallet,
  sourceEscrowIndex,
  destEscrowIndex,
} from "./bridgeEscrow.js";
import {
  computeGasTopUp,
  currentGasPriceWei,
  fundEscrowGas,
  sendEscrowTx,
  approveErc20FromEscrow,
} from "./bridgeEscrowTx.js";
import { makeSourceChainOps, withdrawEscrowLeaf } from "./bridgeSourceWithdraw.js";
import { makeDestChainOps, creditDestShielded } from "./bridgeDestCredit.js";
import { applyLedgerSplit } from "./bridgeLedgerSplit.js";
import { createDeBridgeClient, DEBRIDGE_NATIVE } from "./deBridgeClient.js";
import { ledgerCurrencyToMerkleToken } from "./ledgerLeaves.js";
import { resolveDestBridgeCurrency } from "./bridgeTokenMap.js";
import { Bridge } from "../models/Bridge.js";

const GAS_LIMIT_GUESS = 350_000n;
const GAS_BUFFER_PCT = 50;
const FULFILL_POLL_MS = 5_000;
const FULFILL_MAX_TRIES = 120; // ~10 min

/**
 * Resolve the private key that fronts escrow gas: the dedicated
 * BRIDGE_GAS_PRIVATE_KEY if set, else the admin signer. Privileged on-chain
 * calls (adminWithdraw/updateMerkleRoot) always use ADMIN_PRIVATE_KEY elsewhere;
 * this only covers the plain ETH gas-funding leg.
 */
export function resolveBridgeGasKey(env: Env): string {
  return (env.BRIDGE_GAS_PRIVATE_KEY?.trim() || env.ADMIN_PRIVATE_KEY?.trim()) ?? "";
}

function escrowWallets(env: Env, nonce: number) {
  const seed = env.BRIDGE_ESCROW_SEED;
  if (!seed) throw new Error("BRIDGE_ESCROW_SEED is not configured");
  return {
    src: deriveEscrowWallet(seed, sourceEscrowIndex(nonce)),
    dst: deriveEscrowWallet(seed, destEscrowIndex(nonce)),
  };
}

export function makeBridgeExecutor(env: Env): BridgeExecutor {
  const deBridge = createDeBridgeClient({
    apiUrl: env.DEBRIDGE_API_URL,
    statsApiUrl: env.DEBRIDGE_STATS_API_URL,
    referralCode: env.DEBRIDGE_REFERRAL_CODE,
    affiliateFeePercent: env.BRIDGE_FEE_BPS / 100,
  });

  // Dedicated bridge gas wallet, if configured; otherwise the admin signer
  // fronts gas (it already signs adminWithdraw/updateMerkleRoot). The key is
  // chain-agnostic — the same private key derives the same hot wallet on both
  // Base and Ethereum.
  const gasPrivateKey = resolveBridgeGasKey(env);

  async function topUp(chainEnv: Env, escrow: string): Promise<string> {
    const price = await currentGasPriceWei(chainEnv.RPC_URL!.trim(), chainEnv.CHAIN_ID);
    const amount = computeGasTopUp({
      gasLimit: GAS_LIMIT_GUESS,
      gasPriceWei: price,
      bufferPct: GAS_BUFFER_PCT,
      floorWei: 100_000_000_000_000n,
    });
    const { txHash } = await fundEscrowGas({
      rpcUrl: chainEnv.RPC_URL!.trim(),
      staticChainId: chainEnv.CHAIN_ID,
      adminPrivateKey: gasPrivateKey,
      escrowAddress: escrow,
      amountWei: amount,
    });
    return txHash;
  }

  return {
    async fundSourceGas(b: IBridge) {
      const srcEnv = bridgeChainEnv(env, b.sourceChainId);
      const { src } = escrowWallets(env, b.escrowNonce!);
      await Bridge.updateOne(
        { bridgeId: b.bridgeId },
        { $set: { sourceEscrowAddress: src.address.toLowerCase() } }
      );
      return topUp(srcEnv, src.address);
    },

    async sourceWithdraw(b: IBridge) {
      const srcEnv = bridgeChainEnv(env, b.sourceChainId);
      const { src } = escrowWallets(env, b.escrowNonce!);
      const r = await withdrawEscrowLeaf({
        chainId: b.sourceChainId,
        currency: b.currency,
        userAddress: b.userAddress,
        escrowAddress: src.address.toLowerCase(),
        amount: BigInt(b.amountRequested),
        chain: makeSourceChainOps(srcEnv),
      });
      return { adminWithdrawTxHash: r.adminWithdrawTxHash };
    },

    async submitDeBridgeOrder(b: IBridge) {
      const srcEnv = bridgeChainEnv(env, b.sourceChainId);
      const { src, dst } = escrowWallets(env, b.escrowNonce!);
      const srcToken = ledgerCurrencyToMerkleToken(b.currency); // 0x0 for native
      // USDC has a different address per chain — resolve the dest token, never
      // reuse the source address (deBridge rejects it, deposit would mis-target).
      const destCurrency = resolveDestBridgeCurrency(
        b.currency,
        b.sourceChainId,
        b.destChainId
      );
      const dstToken = ledgerCurrencyToMerkleToken(destCurrency);
      const order = await deBridge.createOrderTx({
        srcChainId: b.sourceChainId,
        srcTokenIn: srcToken,
        srcAmountIn: b.amountRequested,
        dstChainId: b.destChainId,
        dstTokenOut: dstToken, // same asset, destination-chain address
        dstRecipient: dst.address,
        srcOrderAuthority: src.address,
        dstOrderAuthority: dst.address,
        senderAddress: src.address,
      });
      await Bridge.updateOne(
        { bridgeId: b.bridgeId },
        { $set: { destEscrowAddress: dst.address.toLowerCase() } }
      );

      const rpcUrl = srcEnv.RPC_URL!.trim();
      const orderValue = BigInt(order.tx.value);
      const isNative = srcToken.toLowerCase() === DEBRIDGE_NATIVE;

      // The escrow must hold the order's native value — deBridge's fixed
      // protocol fee, plus the principal itself for native bridges — AND gas for
      // the approve + order txs. fundSourceGas only seeded a single-tx gas floor,
      // so top up the shortfall now that the exact value is known.
      const price = await currentGasPriceWei(rpcUrl, srcEnv.CHAIN_ID);
      const gasForTxs = computeGasTopUp({
        gasLimit: GAS_LIMIT_GUESS * 2n, // approve + order
        gasPriceWei: price,
        bufferPct: GAS_BUFFER_PCT,
        floorWei: 100_000_000_000_000n,
      });
      const needed = orderValue + gasForTxs;
      const provider = new ethers.JsonRpcProvider(rpcUrl, srcEnv.CHAIN_ID, {
        staticNetwork: srcEnv.CHAIN_ID != null,
      });
      const bal = await provider.getBalance(src.address);
      if (bal < needed) {
        await fundEscrowGas({
          rpcUrl,
          staticChainId: srcEnv.CHAIN_ID,
          adminPrivateKey: gasPrivateKey,
          escrowAddress: src.address,
          amountWei: needed - bal,
        });
      }

      // ERC-20 input: deBridge pulls the token from the escrow, so approve the
      // DLN source contract (order.tx.to) for the input amount before ordering.
      if (!isNative) {
        await approveErc20FromEscrow({
          rpcUrl,
          staticChainId: srcEnv.CHAIN_ID,
          escrowWallet: src,
          token: srcToken,
          spender: order.tx.to,
          amount: BigInt(b.amountRequested),
        });
      }

      const { txHash } = await sendEscrowTx({
        rpcUrl,
        staticChainId: srcEnv.CHAIN_ID,
        escrowWallet: src,
        to: order.tx.to,
        data: order.tx.data,
        valueWei: orderValue,
      });
      return { orderId: order.orderId, bridgeTxHash: txHash };
    },

    async waitForFulfillment(orderId: string) {
      let lastErr: unknown = null;
      for (let i = 0; i < FULFILL_MAX_TRIES; i++) {
        try {
          const status = await deBridge.getOrderStatus(orderId);
          if (["Fulfilled", "SentUnlock", "ClaimedUnlock"].includes(status)) {
            // The actual received amount is finalized from the dest escrow's
            // on-chain balance in destDepositAndCredit. Provisional here.
            const b = await Bridge.findOne({ deBridgeOrderId: orderId }).lean<IBridge | null>();
            return { received: BigInt(b?.amountReceived ?? b?.amountRequested ?? "0") };
          }
          if (status === "OrderCancelled") {
            throw new Error(`deBridge order ${orderId} cancelled`);
          }
          lastErr = null;
        } catch (e) {
          // deBridge's stats API lags the chain — a freshly-submitted order
          // 404/422s as "Order not found" until indexed. Treat transient lookup
          // errors as "still pending" and keep polling. A genuine cancellation
          // is terminal and rethrown.
          if (e instanceof Error && /cancelled/i.test(e.message)) throw e;
          lastErr = e;
        }
        await new Promise((r) => setTimeout(r, FULFILL_POLL_MS));
      }
      const tail = lastErr instanceof Error ? ` (last poll error: ${lastErr.message})` : "";
      throw new Error(`deBridge order ${orderId} not fulfilled in time${tail}`);
    },

    async fundDestGas(b: IBridge) {
      const dstEnv = bridgeChainEnv(env, b.destChainId);
      const { dst } = escrowWallets(env, b.escrowNonce!);
      const token = ledgerCurrencyToMerkleToken(b.currency);
      if (token.toLowerCase() === DEBRIDGE_NATIVE) {
        // Native: the bridged principal is the escrow's balance BEFORE we add
        // gas (gas is funded into the same address). Capture it now so the
        // deposit credits the real received amount, not principal + gas.
        const provider = new ethers.JsonRpcProvider(dstEnv.RPC_URL!.trim(), dstEnv.CHAIN_ID, {
          staticNetwork: dstEnv.CHAIN_ID != null,
        });
        const principal = await provider.getBalance(dst.address);
        await Bridge.updateOne(
          { bridgeId: b.bridgeId },
          { $set: { amountReceived: principal.toString() } }
        );
      }
      return topUp(dstEnv, dst.address);
    },

    async destDepositAndCredit(b: IBridge) {
      const dstEnv = bridgeChainEnv(env, b.destChainId);
      const { dst } = escrowWallets(env, b.escrowNonce!);
      // The escrow received the DESTINATION-chain token (e.g. Eth USDC), which
      // has a different address than the source. Resolve it so balanceOf, the
      // vault deposit, and the ledger credit all key off the dest asset.
      const destCurrency = resolveDestBridgeCurrency(
        b.currency,
        b.sourceChainId,
        b.destChainId
      );
      const token = ledgerCurrencyToMerkleToken(destCurrency);
      // Use the ACTUAL balance the escrow received on the destination chain.
      const provider = new ethers.JsonRpcProvider(dstEnv.RPC_URL!.trim(), dstEnv.CHAIN_ID, {
        staticNetwork: dstEnv.CHAIN_ID != null,
      });
      let received: bigint;
      if (token.toLowerCase() === DEBRIDGE_NATIVE) {
        // Native: use the pre-gas principal captured in fundDestGas. Depositing
        // this exact amount leaves the separately-funded gas top-up to pay for
        // the deposit tx itself.
        received = BigInt(b.amountReceived ?? b.amountRequested);
      } else {
        const erc20 = new ethers.Contract(
          token,
          ["function balanceOf(address) view returns (uint256)"],
          provider
        );
        received = (await erc20.balanceOf(dst.address)) as bigint;
      }
      await Bridge.updateOne(
        { bridgeId: b.bridgeId },
        { $set: { amountReceived: received.toString(), destShieldedAddress: b.userAddress } }
      );
      const r = await creditDestShielded({
        chainId: b.destChainId,
        currency: destCurrency,
        shieldedAddress: b.userAddress,
        amountReceived: received,
        chain: makeDestChainOps({ env: dstEnv, escrowWallet: dst }),
      });
      return { depositTxHash: r.depositTxHash };
    },

    async refundToSource(b: IBridge) {
      // Pre-fulfillment refund: the off-chain split already debited the user and
      // credited the escrow leaf. If the escrow was NOT yet withdrawn on-chain,
      // move the escrow leaf balance back to the user leaf. (If it was withdrawn,
      // the funds are at the escrow address and recovered by a separate sweep.)
      const { src } = escrowWallets(env, b.escrowNonce!);
      await applyLedgerSplit({
        userAddress: src.address.toLowerCase(), // escrow becomes the "source"
        escrowAddress: b.userAddress, // user receives back
        chainId: b.sourceChainId,
        currency: b.currency,
        amount: BigInt(b.amountRequested),
      }).catch(() => {
        // If the escrow leaf was already zeroed (withdrawn on-chain), there is
        // nothing to move back here; on-chain escrow funds need an ops sweep.
      });
    },
  };
}
