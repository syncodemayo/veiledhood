import type { Env } from "../config/env.js";
import { UserBalance } from "../models/UserBalance.js";
import { aggregateUserBalancesForMe } from "../util/ledgerCurrency.js";
import { getTokenByAddress, getTokenList, isSupportedChain } from "../util/tokenLists.js";
import type { PooledRpcProxy, TokenBalance } from "./pooledRpcProxy.js";
import type { PriceOracle } from "./priceOracle.js";
import { base, mainnet } from "viem/chains";

/**
 * walletContextAggregator — Phase 3 service layer.
 *
 * Combines:
 *   • shielded balances (Mongo UserBalance — same source as /user/me)
 *   • public balances (pooledRpcProxy.getBalances + getNativeBalance)
 *   • USD enrichment (priceOracle)
 *
 * The aggregator NEVER persists or logs the holder address in cleartext.
 * It accepts the address as an argument (from JWT-authenticated routes) and
 * returns it to the same caller for echo; nothing in this module writes the
 * address to disk or to external systems.
 */

export interface ShieldedAssetView {
  /** ledger currency key — `native`, `usdc`, etc. */
  readonly currency: string;
  /** raw amount as base-10 string */
  readonly amount: string;
  /** decimals used by ledger for this asset (informational) */
  readonly decimals?: number;
  /** symbol for display, when knowable from token list mapping */
  readonly symbol?: string;
  /** USD value when price + decimals are both available */
  readonly usdValue: number | null;
}

export interface PublicTokenView {
  readonly address: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly balance: string;
  readonly priceUsd: number | null;
  readonly usdValue: number | null;
}

export interface PublicNativeView {
  readonly symbol: string;
  readonly balance: string;
  readonly priceUsd: number | null;
  readonly usdValue: number | null;
}

export interface WalletContextShielded {
  readonly address: string;
  readonly chainId: number;
  readonly balances: ReadonlyArray<ShieldedAssetView>;
  readonly totalUsd: number | null;
  readonly at: number;
}

export interface WalletContextPublic {
  readonly address: string;
  readonly chainId: number;
  readonly native: PublicNativeView;
  readonly tokens: ReadonlyArray<PublicTokenView>;
  readonly totalUsd: number | null;
  readonly at: number;
}

export interface WalletContextFull {
  readonly address: string;
  readonly chainId: number;
  readonly shielded: Omit<WalletContextShielded, "address" | "chainId" | "at">;
  readonly public: Omit<WalletContextPublic, "address" | "chainId" | "at">;
  readonly totalUsd: number | null;
  readonly at: number;
  /** Privacy posture — meant for surfacing in the Portfolio UI. */
  readonly privacy: {
    readonly decoyRatio: number;
    readonly batchWindowMs: number;
  };
}

export interface WalletContextAggregator {
  getShielded(address: string, chainId: number): Promise<WalletContextShielded>;
  getPublic(address: string, chainId: number): Promise<WalletContextPublic>;
  getFull(address: string, chainId: number): Promise<WalletContextFull>;
}

/** Map ledger currency keys (used in UserBalance) → token list symbols. */
const LEDGER_CURRENCY_TO_SYMBOL: Readonly<Record<string, { symbol: string; decimals: number }>> = {
  native: { symbol: "ETH", decimals: 18 },
  eth: { symbol: "ETH", decimals: 18 },
  usdc: { symbol: "USDC", decimals: 6 },
  usdt: { symbol: "USDT", decimals: 6 },
  dai: { symbol: "DAI", decimals: 18 },
  wbtc: { symbol: "WBTC", decimals: 8 },
};

function computeUsdValue(rawBalance: string, decimals: number, priceUsd: number | null): number | null {
  if (priceUsd === null) return null;
  if (rawBalance === "0") return 0;
  try {
    const raw = BigInt(rawBalance);
    if (raw === 0n) return 0;
    // (raw / 10^decimals) * priceUsd. Use float math after scaling to bigint-safe range.
    // For typical balances this is sufficient; v1.1 can switch to decimal.js for full precision.
    const whole = Number(raw / 10n ** BigInt(decimals));
    const frac = Number(raw % 10n ** BigInt(decimals)) / Math.pow(10, decimals);
    return (whole + frac) * priceUsd;
  } catch {
    return null;
  }
}

function nativeSymbolForChain(chainId: number): string {
  if (chainId === base.id) return "ETH";
  if (chainId === mainnet.id) return "ETH";
  return "ETH";
}

/**
 * Resolve the price feed for a chain's native asset by piggy-backing on the
 * chain's WETH token entry — both Base and Ethereum mainnet have WETH in the
 * token list with `pythSymbol: Crypto.ETH/USD`.
 */
function nativeTokenLookup(chainId: number): { coingeckoId?: string; pythSymbol?: string } | null {
  const list = getTokenList(chainId);
  const weth = list.find((t) => t.symbol.toUpperCase() === "WETH");
  if (!weth) return null;
  return { coingeckoId: weth.coingeckoId, pythSymbol: weth.pythSymbol };
}

export function createWalletContextAggregator(
  env: Env,
  deps: { proxy: PooledRpcProxy; oracle: PriceOracle },
): WalletContextAggregator {
  const { proxy, oracle } = deps;

  async function getShielded(address: string, chainId: number): Promise<WalletContextShielded> {
    const rows = await UserBalance.find({
      address,
      chainId,
    })
      .select("currency totalAmount chainId")
      .lean();

    const merged = aggregateUserBalancesForMe(
      rows.map((b) => ({
        currency: b.currency,
        totalAmount: b.totalAmount,
        chainId: b.chainId,
      })),
    );

    // Build a token-list lookup for shielded → symbol + price
    const tokenList = getTokenList(chainId);
    const symbolToToken = new Map(tokenList.map((t) => [t.symbol.toUpperCase(), t]));

    const balances: ShieldedAssetView[] = [];
    const priceTokens = new Set<string>();
    const symbolByCurrency = new Map<string, string>();

    for (const row of merged) {
      // Drop zero-balance rows — they only add visual noise (especially when
      // `currency` is a raw token contract address with no symbol mapping).
      if (row.totalAmount === "0") continue;

      const currency = row.currency.trim().toLowerCase();
      const mapped = LEDGER_CURRENCY_TO_SYMBOL[currency];
      let symbol: string;
      let decimals: number | undefined;
      if (mapped) {
        symbolByCurrency.set(currency, mapped.symbol);
        symbol = mapped.symbol;
        decimals = mapped.decimals;
      } else if (/^0x[a-f0-9]{40}$/.test(currency)) {
        // Raw token contract address — look up symbol via chain token list
        const byAddress = getTokenByAddress(chainId, currency);
        if (byAddress) {
          symbol = byAddress.symbol;
          decimals = byAddress.decimals;
          symbolByCurrency.set(currency, symbol);
        } else {
          // Unknown contract — show middle-ellipsis instead of full 40-char hex
          symbol = `${currency.slice(0, 6)}…${currency.slice(-4)}`;
          decimals = undefined;
        }
      } else {
        symbol = row.currency.toUpperCase();
        decimals = undefined;
      }
      const token = symbolToToken.get(symbol.toUpperCase());
      if (token) priceTokens.add(token.address);
      balances.push({
        currency: row.currency,
        amount: row.totalAmount,
        decimals,
        symbol,
        usdValue: null, // populated after price fetch
      });
    }

    // Fetch prices for shielded assets that map to known tokens
    const priceMap = new Map<string, number | null>();
    if (priceTokens.size > 0) {
      const toFetch = tokenList.filter((t) => priceTokens.has(t.address));
      const fetched = await oracle.getPricesUsd(toFetch);
      for (const t of toFetch) {
        priceMap.set(t.symbol.toUpperCase(), fetched.get(t.address)?.priceUsd ?? null);
      }
    }

    let totalUsd: number | null = null;
    const enriched = balances.map((b): ShieldedAssetView => {
      const priceUsd = b.symbol ? priceMap.get(b.symbol.toUpperCase()) ?? null : null;
      const decimals = b.decimals;
      const usdValue =
        priceUsd !== null && decimals !== undefined
          ? computeUsdValue(b.amount, decimals, priceUsd)
          : null;
      if (usdValue !== null) totalUsd = (totalUsd ?? 0) + usdValue;
      return { ...b, usdValue };
    });

    return {
      address,
      chainId,
      balances: enriched,
      totalUsd,
      at: Date.now(),
    };
  }

  async function getPublic(address: string, chainId: number): Promise<WalletContextPublic> {
    if (!isSupportedChain(chainId)) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }
    const tokenList = getTokenList(chainId);

    const [tokenBalances, nativeBalance] = await Promise.all([
      proxy.getBalances(chainId, address, tokenList),
      proxy.getNativeBalance(chainId, address),
    ]);

    // Fetch prices for all tokens + native via WETH proxy
    const nativeProxy = nativeTokenLookup(chainId);
    const tokensToPrice = [...tokenList];
    const fetched = await oracle.getPricesUsd(tokensToPrice);

    // Native price = whatever Pyth/Gecko returned for WETH (ETH/USD feed)
    let nativePriceUsd: number | null = null;
    if (nativeProxy) {
      const wethEntry = tokenList.find((t) => t.symbol.toUpperCase() === "WETH");
      if (wethEntry) nativePriceUsd = fetched.get(wethEntry.address)?.priceUsd ?? null;
    }

    let totalUsd: number | null = null;
    const tokens: PublicTokenView[] = tokenBalances.map((b: TokenBalance): PublicTokenView => {
      const priceUsd = fetched.get(b.address)?.priceUsd ?? null;
      const usdValue =
        priceUsd !== null ? computeUsdValue(b.balance, b.decimals, priceUsd) : null;
      if (usdValue !== null) totalUsd = (totalUsd ?? 0) + usdValue;
      return {
        address: b.address,
        symbol: b.symbol,
        decimals: b.decimals,
        balance: b.balance,
        priceUsd,
        usdValue,
      };
    });

    const nativeUsd =
      nativePriceUsd !== null
        ? computeUsdValue(nativeBalance.balance, 18, nativePriceUsd)
        : null;
    if (nativeUsd !== null) totalUsd = (totalUsd ?? 0) + nativeUsd;

    return {
      address,
      chainId,
      native: {
        symbol: nativeSymbolForChain(chainId),
        balance: nativeBalance.balance,
        priceUsd: nativePriceUsd,
        usdValue: nativeUsd,
      },
      tokens,
      totalUsd,
      at: Date.now(),
    };
  }

  async function getFull(address: string, chainId: number): Promise<WalletContextFull> {
    const [shielded, pub] = await Promise.all([
      getShielded(address, chainId),
      getPublic(address, chainId),
    ]);

    let totalUsd: number | null = null;
    if (shielded.totalUsd !== null) totalUsd = (totalUsd ?? 0) + shielded.totalUsd;
    if (pub.totalUsd !== null) totalUsd = (totalUsd ?? 0) + pub.totalUsd;

    return {
      address,
      chainId,
      shielded: { balances: shielded.balances, totalUsd: shielded.totalUsd },
      public: {
        native: pub.native,
        tokens: pub.tokens,
        totalUsd: pub.totalUsd,
      },
      totalUsd,
      at: Date.now(),
      privacy: {
        decoyRatio: env.RPC_POOL_DECOY_RATIO,
        batchWindowMs: env.RPC_POOL_BATCH_WINDOW_MS,
      },
    };
  }

  return { getShielded, getPublic, getFull };
}
