import { parseAbi } from "viem";

/** Minimal VeilSwap ABI — mirrors api/src/abi/veilSwap.ts, deposit side only. */
export const VEILSWAP_ABI = parseAbi([
  "event Deposited(address indexed depositor, address indexed token, uint256 amount)",
  "function deposit(address token, uint256 amount) external payable",
]);
