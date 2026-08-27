/** Add two non-negative integer strings (base units). */
export function addIntegerStrings(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

export function isPositiveIntegerString(s: string): boolean {
  if (!/^\d+$/.test(s)) return false;
  try {
    return BigInt(s) > 0n;
  } catch {
    return false;
  }
}
