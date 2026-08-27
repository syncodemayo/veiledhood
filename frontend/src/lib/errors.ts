/** Detects a user cancelling a wallet prompt — ethers' own ACTION_REJECTED code,
 * or the raw EIP-1193 JSON-RPC rejection code 4001, in whatever shape it arrives. */
function isUserRejection(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const obj = e as { code?: unknown; info?: { error?: { code?: unknown } } };
  if (obj.code === "ACTION_REJECTED") return true;
  if (obj.code === 4001) return true;
  if (obj.info?.error?.code === 4001) return true;
  return false;
}

/** Extracts a human-readable message from any thrown value, including raw
 * EIP-1193 wallet RPC rejections, which are plain objects like
 * `{ code: 4001, message: "User rejected the request." }`, not Error instances. */
export function errorMessage(e: unknown, fallback: string): string {
  if (isUserRejection(e)) return "You rejected the request in your wallet.";
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null) {
    const obj = e as { message?: unknown; error?: { message?: unknown } };
    if (typeof obj.message === "string" && obj.message) return obj.message;
    if (typeof obj.error?.message === "string" && obj.error.message) return obj.error.message;
  }
  if (typeof e === "string" && e) return e;
  return fallback;
}
