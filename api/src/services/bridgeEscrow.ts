import { ethers } from "ethers";

/**
 * Dedicated BIP-44 account branch for bridge escrow keys, isolated from any
 * other derivation the system might do. m / 44' / 60' / 7' / 0 / <index>.
 */
const ESCROW_PATH_PREFIX = "m/44'/60'/7'/0";

/**
 * Each bridge `n` (a monotonic integer) gets two leaf indices so the source
 * and destination escrow addresses differ: 2n (source) and 2n+1 (destination).
 */
export function sourceEscrowIndex(bridgeNonce: number): number {
  return bridgeNonce * 2;
}
export function destEscrowIndex(bridgeNonce: number): number {
  return bridgeNonce * 2 + 1;
}

/**
 * Derive a fresh escrow wallet. Deterministic in (seed, index) so resume can
 * re-derive after a crash. The returned wallet holds the key in memory only;
 * NEVER log `wallet.privateKey`.
 */
export function deriveEscrowWallet(seed: string, index: number): ethers.HDNodeWallet {
  if (!seed?.trim()) {
    throw new Error("BRIDGE_ESCROW_SEED is not configured");
  }
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`escrow index must be a non-negative integer, got ${index}`);
  }
  return ethers.HDNodeWallet.fromPhrase(
    seed.trim(),
    "",
    `${ESCROW_PATH_PREFIX}/${index}`
  );
}
