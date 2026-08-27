import { NATIVE_CURRENCY_KEY } from "../constants/currency.js";
import { getTokenByAddress, getTokenBySymbol } from "../util/tokenLists.js";

/**
 * Map a source-chain ledger currency to the SAME asset's ledger currency on the
 * destination chain.
 *
 * Native ETH is chain-agnostic ("native" on both sides). ERC-20s (e.g. USDC)
 * have DIFFERENT contract addresses per chain — Base USDC
 * 0x8335… vs Ethereum USDC 0xa0b8… — so the destination token must be resolved
 * by symbol, never reused from the source. Passing the source address as the
 * deBridge `dstChainTokenOut` (or as the dest deposit/ledger token) is a bug:
 * deBridge rejects it (500) and an on-chain deposit would target a non-token.
 *
 * Throws if the asset isn't listed on either chain.
 */
export function resolveDestBridgeCurrency(
  currency: string,
  sourceChainId: number,
  destChainId: number
): string {
  const c = currency.trim().toLowerCase();
  if (c === NATIVE_CURRENCY_KEY.toLowerCase()) return NATIVE_CURRENCY_KEY;

  const srcEntry = getTokenByAddress(sourceChainId, c);
  if (!srcEntry) {
    throw new Error(`Unsupported bridge asset ${c} on chain ${sourceChainId}`);
  }
  const dstEntry = getTokenBySymbol(destChainId, srcEntry.symbol);
  if (!dstEntry) {
    throw new Error(
      `${srcEntry.symbol} is not available on destination chain ${destChainId}`
    );
  }
  return dstEntry.address;
}
