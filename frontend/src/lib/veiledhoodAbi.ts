import { parseAbi } from "viem";

/** Minimal Veiledhood vault ABI — mirrors api/src/abi/veiledhood.ts. */
export const VEILEDHOOD_ABI = parseAbi([
  "event Deposited(address indexed depositor, address indexed token, uint256 amount)",
  "function deposit(address token, uint256 amount) external payable",
  "function getMerkleRoot() view returns (bytes32)",
  "function withdraw(address user, address token, uint256 balance, bytes32[] calldata proof, uint256 deadline, bytes calldata sig) external",
]);
