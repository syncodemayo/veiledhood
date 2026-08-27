/**
 * One-off: zero VeilSwap ledger for a wallet after on-chain withdraw succeeded
 * but record-withdraw failed. Usage: node scripts/fix-veilswap-db.js [address]
 */
const user = "0xa5fdb69f410ff432b2033b01c45c794e1f5949d8";

const bal = db.swapuserbalances.updateMany(
  { address: user },
  { $set: { totalAmount: "0" } }
);

const swaps = db.swaps.updateMany(
  { fromAddress: user, status: "failed" },
  { $set: { status: "payout_completed" }, $unset: { payoutError: "" } }
);

print("User:", user);
print("Balances zeroed:", JSON.stringify(bal));
print("Failed swaps marked payout_completed:", JSON.stringify(swaps));
print("\nBalances:");
printjson(db.swapuserbalances.find({ address: user }).toArray());
print("\nSwaps:");
printjson(
  db.swaps
    .find(
      { fromAddress: user },
      { idempotencyKey: 1, status: 1, swapTxHash: 1, adminWithdrawTxHash: 1 }
    )
    .toArray()
);
