/** Minimal VeilSwap ABI for deposit recording + swap execution + admin flows. */
export const VEILSWAP_ABI = [
  "event Deposited(address indexed depositor, address indexed token, uint256 amount)",
  "event SwapExecuted(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, bytes32 nullifier)",
  "event AdminWithdrawal(address indexed user, address indexed token, uint256 amount, bytes32 nullifier)",
  "event UserWithdrawal(address indexed user, address indexed token, uint256 amount, bytes32 nullifier)",
  "function getMerkleRoot() view returns (bytes32)",
  "function updateMerkleRoot(bytes32 newRoot) external",
  "function getReserves(address token) view returns (uint256)",
  "function adminExecuteSwap(address user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bytes32[] calldata proof, uint256 deadline) external",
  "function adminWithdraw(address user, address token, uint256 balance, bytes32[] calldata proof, uint256 deadline, bytes calldata sig) external",
  "function withdraw(address user, address token, uint256 balance, bytes32[] calldata proof, uint256 deadline, bytes calldata sig) external",
  "function verifyBalance(address user, address token, uint256 balance, bytes32[] calldata proof) view returns (bool)",
  "function isNullifierSpent(bytes32 nullifier) view returns (bool)",
] as const;
