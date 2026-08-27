/** Matches Solidity: fixed + floor(amount * bps / 10000). */
export function computeTransferTotalFees(
  amount: bigint,
  fixed: bigint,
  bps: number
): bigint {
  return fixed + (amount * BigInt(bps)) / 10000n;
}

export type TransferFeeBreakdown = {
  fixedFee: bigint;
  bpsFee: bigint;
  totalFees: bigint;
};

/** Fixed and BPS-derived parts; total matches `computeTransferTotalFees`. */
export function computeTransferFeeBreakdown(
  amount: bigint,
  fixed: bigint,
  bps: number
): TransferFeeBreakdown {
  const bpsFee = (amount * BigInt(bps)) / 10000n;
  const fixedFee = fixed;
  const totalFees = computeTransferTotalFees(amount, fixed, bps);
  return { fixedFee, bpsFee, totalFees };
}
