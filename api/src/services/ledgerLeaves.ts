import { ethers } from "ethers";
import type { IUserBalance } from "../models/UserBalance.js";
import { NATIVE_CURRENCY_KEY } from "../constants/currency.js";
import { canonicalLedgerCurrencyKey } from "../util/ledgerCurrency.js";
import type { MerkleLeafInput } from "./merkleTree.js";

/** Ledger currency key → `token` for Veiledhood (native → `address(0)`). */
export function ledgerCurrencyToMerkleToken(currency: string): string {
  const cur = canonicalLedgerCurrencyKey(currency);
  return cur === NATIVE_CURRENCY_KEY.toLowerCase()
    ? ethers.ZeroAddress
    : ethers.getAddress(cur);
}

/** Map DB `UserBalance` rows to `(user, token, balance)` for Veiledhood Merkle (only positive balances). */
export function userBalancesToMerkleLeaves(
  rows: Pick<IUserBalance, "address" | "currency" | "totalAmount">[]
): MerkleLeafInput[] {
  const leaves: MerkleLeafInput[] = [];
  for (const row of rows) {
    const raw = (row.totalAmount ?? "").trim();
    if (!/^\d+$/.test(raw)) continue;
    const balance = BigInt(raw);
    if (balance <= 0n) continue;
    const cur = canonicalLedgerCurrencyKey(row.currency);
    const token =
      cur === NATIVE_CURRENCY_KEY.toLowerCase()
        ? ethers.ZeroAddress
        : ethers.getAddress(cur);
    leaves.push({
      user: ethers.getAddress(row.address),
      token,
      balance,
    });
  }
  return leaves;
}
