/** Minimal Veiledhood ABI for indexer + admin flows. */
export const VEILEDHOOD_ABI = [
  "event Deposited(address indexed depositor, address indexed token, uint256 amount)",
  "function deposit(address token, uint256 amount) external payable",
  "function getMerkleRoot() view returns (bytes32)",
  "function updateMerkleRoot(bytes32 newRoot) external",
  "function adminWithdraw(address user, address token, uint256 balance, bytes32[] calldata proof, uint256 deadline, bytes calldata sig) external",
  "function withdraw(address user, address token, uint256 balance, bytes32[] calldata proof, uint256 deadline, bytes calldata sig) external",
  "function verifyBalance(address user, address token, uint256 balance, bytes32[] calldata proof) view returns (bool)",
  "function isNullifierSpent(bytes32 nullifier) view returns (bool)",
] as const;

