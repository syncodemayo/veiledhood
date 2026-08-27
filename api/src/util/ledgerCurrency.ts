import { ethers } from "ethers";

/**
 * Canonical form for ledger rows: ERC-20 keys as lowercase 0x…; other keys
 * (e.g. `native` for ETH) lowercased so `Native` / `NATIVE` still match DB.
 */
export function normalizeLedgerCurrency(currency: string): string {
  return currency.trim().toLowerCase();
}

/**
 * Single key for grouping `UserBalance` rows (EIP-55 vs lowercase duplicates).
 */
export function canonicalLedgerCurrencyKey(currency: string): string {
  const t = currency.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(t)) {
    return t.toLowerCase();
  }
  return normalizeLedgerCurrency(t);
}

export type UserBalanceRow = { currency: string; totalAmount: string; chainId?: number };

/**
 * Merge duplicate currency rows (mixed-case token address) and sum `totalAmount`.
 */
export function aggregateUserBalancesForMe(rows: UserBalanceRow[]): UserBalanceRow[] {
  const map = new Map<string, { total: bigint; chainId?: number }>();
  for (const b of rows) {
    const key = `${b.chainId ?? 0}:${canonicalLedgerCurrencyKey(b.currency)}`;
    const raw = (b.totalAmount ?? "").trim();
    const add = /^\d+$/.test(raw) ? BigInt(raw) : 0n;
    const prev = map.get(key);
    map.set(key, {
      total: (prev?.total ?? 0n) + add,
      chainId: b.chainId,
    });
  }
  return Array.from(map.entries())
    .map(([compoundKey, sum]) => {
      const [, ...currencyParts] = compoundKey.split(":");
      return {
        currency: currencyParts.join(":"),
        totalAmount: sum.total.toString(),
        chainId: sum.chainId,
      };
    })
    .sort((a, b) => {
      const chainCmp = (a.chainId ?? 0) - (b.chainId ?? 0);
      if (chainCmp !== 0) return chainCmp;
      return a.currency.localeCompare(b.currency);
    });
}

/**
 * Match existing UserBalance rows that may use lowercase or EIP-55 checksummed token addresses.
 */
export function ledgerCurrencyMatchKeys(currency: string): string[] {
  const cur = normalizeLedgerCurrency(currency);
  if (!/^0x[a-f0-9]{40}$/.test(cur)) {
    return [cur];
  }
  try {
    const checksummed = ethers.getAddress(cur);
    return cur === checksummed ? [cur] : [cur, checksummed];
  } catch {
    return [cur];
  }
}
