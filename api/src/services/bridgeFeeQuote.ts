export function applyVeiledhoodBridgeFee(params: {
  amountIn: bigint;
  deBridgeOut: bigint;
  feeBps: number;
}): { veiledhoodFee: bigint; recipientReceives: bigint } {
  const { amountIn, deBridgeOut, feeBps } = params;
  const veiledhoodFee = (amountIn * BigInt(Math.max(0, Math.floor(feeBps)))) / 10_000n;
  const recipientReceives = deBridgeOut > veiledhoodFee ? deBridgeOut - veiledhoodFee : 0n;
  return { veiledhoodFee, recipientReceives };
}
