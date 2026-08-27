// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Veiledhood
 * @notice Pooled custody vault for ERC-20 + native ETH with an off-chain ledger committed via a Merkle root.
 * @dev Per-user balances are not stored in contract storage. Instead, the system commits to a global Merkle root
 *      updated by `_admin`, and withdrawals prove inclusion of a `(user, token, balance)` leaf under that root.
 *
 * @custom:security-model This design is **not** “fully private on-chain transfers”:
 * - Deposits and withdrawals are normal EVM transactions: calldata and emitted events are public.
 * - `verifyBalance` is a public `view` helper: anyone can supply candidate values and learn whether a leaf matches.
 *
 * @custom:roles
 * - `_admin`: may update the Merkle root, relay withdrawals to any `user` via `adminWithdraw`, rotate admin, rotate signer, and rescue surplus.
 * - Any EOA: may call `deposit` and `withdraw` (self only: `msg.sender == user`) with valid proof + `WithdrawAuth` signature.
 * - `_withdrawSigner`: must EIP-712-sign each withdrawal authorization (`WithdrawAuth`).
 *
 * @custom:merkle OpenZeppelin `StandardMerkleTree` leaf encoding (double-hash):
 * `leaf = keccak256(bytes.concat(keccak256(abi.encode(user, token, balance))))`.
 *
 * @custom:nullifier `nullifier = keccak256(abi.encode(root, user, token, balance))` binds replay protection to a
 *      specific Merkle root version.
 *
 * @custom:assets Assumes “standard” ERC-20 behavior where `amount` is actually received. Fee-on-transfer/rebasing
 *      tokens can desync `_reserves` from `balanceOf(address(this))`.
 */
contract Veiledhood is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /********** EVENTS **********/
    /// @notice Emitted when `msg.sender` deposits native ETH (`token == address(0)`) or an ERC-20.
    /// @param depositor The funding account (`msg.sender`).
    /// @param token The deposited asset (`address(0)` denotes native ETH).
    /// @param amount The deposited amount (wei for ETH, token smallest units for ERC-20).
    event Deposited(address indexed depositor, address indexed token, uint256 amount);

    /// @notice Emitted when `_admin` publishes a new Merkle root for the off-chain ledger snapshot.
    /// @param newRoot The new Merkle root (non-zero).
    event MerkleRootUpdated(bytes32 indexed newRoot);

    /// @notice Emitted after a successful `adminWithdraw`.
    /// @param user The recipient of withdrawn funds.
    /// @param token The withdrawn asset (`address(0)` denotes native ETH).
    /// @param amount The withdrawn amount (full leaf `balance` for this implementation).
    /// @param nullifier The spent nullifier for this withdrawal.
    event AdminWithdrawal(
        address indexed user,
        address indexed token,
        uint256 amount,
        bytes32 nullifier
    );

    /// @notice Emitted after a successful self-service `withdraw` (`msg.sender == user`).
    event UserWithdrawal(
        address indexed user,
        address indexed token,
        uint256 amount,
        bytes32 nullifier
    );

    /// @notice Emitted when `_admin` is rotated.
    /// @param previousAdmin The prior admin address.
    /// @param newAdmin The new admin address.
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    /// @notice Emitted when `_withdrawSigner` is rotated.
    /// @param newSigner The new signer address.
    event WithdrawSignerUpdated(address indexed newSigner);

    /********** ERRORS **********/
    /// @notice Caller is not `_admin`.
    error OnlyAdmin();
    /// @notice `withdraw` caller is not the payout `user`.
    error NotSelf();
    /// @notice An address parameter was unexpectedly zero.
    error ZeroAddress();
    /// @notice An amount parameter was unexpectedly zero.
    error ZeroAmount();
    /// @notice `msg.value` did not match the ETH deposit invariant for `deposit`.
    error MsgValueMismatch();
    /// @notice The supplied Merkle proof does not prove the leaf under the current root.
    error InvalidMerkleProof();
    /// @notice The withdrawal nullifier was already consumed.
    error NullifierAlreadyUsed();
    /// @notice The EIP-712 `deadline` is in the past.
    error WithdrawExpired();
    /// @notice The EIP-712 signature did not recover to `_withdrawSigner`.
    error InvalidSignature();
    /// @notice The vault does not have enough reserved inventory to honor the withdrawal.
    error InsufficientReserves();
    /// @notice Native ETH transfer failed (recipient rejected ETH or out-of-gas on receive/fallback).
    error ETHTransferFailed();
    /// @notice `rescueToken` found no surplus for the requested asset.
    error NoSurplus();

    /********** CONSTANTS **********/
    /// @dev EIP-712 typehash for `WithdrawAuth`.
    bytes32 private constant WITHDRAW_AUTH_TYPEHASH =
        keccak256(
            "WithdrawAuth(address user,address token,uint256 balance,bytes32 nullifier,uint256 deadline)"
        );

    /********** STATE (PRIVATE) **********/
    /// @dev Current Merkle root committing the off-chain ledger snapshot.
    bytes32 private _merkleRoot;

    /// @dev Hot admin key allowed to update roots, withdraw, rotate roles, and rescue surplus.
    address private _admin;

    /// @dev EIP-712 signer for withdrawal authorizations (may equal `_admin`, but separable for ops/security).
    address private _withdrawSigner;

    /// @dev Tracked liability: sum of reserved balances per asset key (`address(0)` == native ETH).
    mapping(address token => uint256) private _reserves;

    /// @dev Replay protection for withdrawals: spent nullifiers cannot be reused.
    mapping(bytes32 nullifier => bool) private _nullifiers;

    /********** MODIFIERS **********/
    /// @dev Restricts function access to `_admin`.
    modifier onlyAdmin() {
        if (msg.sender != _admin) revert OnlyAdmin();
        _;
    }

    /**
     * @notice Initializes role addresses and EIP-712 domain separator (`name="Veiledhood"`, `version="1"`).
     * @param initialAdmin The initial `_admin`.
     * @param initialWithdrawSigner The initial `_withdrawSigner`.
     */
    constructor(address initialAdmin, address initialWithdrawSigner) EIP712("Veiledhood", "1") {
        if (initialAdmin == address(0) || initialWithdrawSigner == address(0)) {
            revert ZeroAddress();
        }
        _admin = initialAdmin;
        _withdrawSigner = initialWithdrawSigner;
    }

    /********** DEPOSITS **********/

    /**
     * @notice Deposit native ETH or pull `amount` of an ERC-20 from `msg.sender` into the vault.
     * @dev ETH path requires `token == address(0)` and `msg.value == amount`. ERC-20 path requires `msg.value == 0`.
     * @param token Asset key: `address(0)` for native ETH, otherwise an ERC-20 contract address.
     * @param amount Amount to credit to `_reserves[token]` (wei for ETH, token units for ERC-20).
     */
    function deposit(address token, uint256 amount) external payable nonReentrant {
        if (amount == 0) revert ZeroAmount();

        if (token == address(0)) {
            if (msg.value != amount) revert MsgValueMismatch();
            _reserves[address(0)] += amount;
            emit Deposited(msg.sender, address(0), amount);
            return;
        }

        if (msg.value != 0) revert MsgValueMismatch();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _reserves[token] += amount;
        emit Deposited(msg.sender, token, amount);
    }

    /**
     * @notice Explicitly rejects direct ETH sends so `_reserves[address(0)]` stays consistent with `deposit`.
     * @dev Reverts with a simple string message for clarity in wallets/explorers.
     */
    receive() external payable {
        revert("Use deposit()");
    }

    /********** MERKLE ROOT **********/

    /**
     * @notice Updates the committed Merkle root for the off-chain ledger snapshot.
     * @dev Rejects `bytes32(0)` as a footgun configuration.
     * @param newRoot Non-zero Merkle root to commit.
     */
    function updateMerkleRoot(bytes32 newRoot) external onlyAdmin {
        if (newRoot == bytes32(0)) revert ZeroAddress();
        _merkleRoot = newRoot;
        emit MerkleRootUpdated(newRoot);
    }

    /**
     * @notice Returns the currently committed Merkle root.
     * @return The Merkle root (may be zero before the first successful `updateMerkleRoot`).
     */
    function getMerkleRoot() external view returns (bytes32) {
        return _merkleRoot;
    }

    /********** WITHDRAWALS **********/

    /**
     * @notice Admin-executed withdrawal that pays `balance` of `token` to `user`.
     * @dev Full-withdrawal model: `balance` must match the Merkle leaf’s committed amount for `(user, token)`.
     *      Users may instead call `withdraw` with the same arguments when `msg.sender == user`.
     *
     * @param user Recipient of funds (must be non-zero).
     * @param token Asset key: `address(0)` for native ETH, otherwise an ERC-20 contract address.
     * @param balance The leaf balance to withdraw (also the payout amount).
     * @param proof Merkle proof for `leaf(user, token, balance)` against `_merkleRoot`.
     * @param deadline EIP-712 authorization expiry (unix seconds).
     * @param sig EIP-712 signature over `WithdrawAuth` by `_withdrawSigner`.
     */
    function adminWithdraw(
        address user,
        address token,
        uint256 balance,
        bytes32[] calldata proof,
        uint256 deadline,
        bytes calldata sig
    ) external onlyAdmin nonReentrant {
        bytes32 nullifier = _executeWithdraw(user, token, balance, proof, deadline, sig);
        emit AdminWithdrawal(user, token, balance, nullifier);
    }

    /**
     * @notice Self-service withdrawal: same validation as `adminWithdraw`, but `msg.sender` must equal `user`.
     * @dev Enables users to pay their own gas to execute the payout tx.
     */
    function withdraw(
        address user,
        address token,
        uint256 balance,
        bytes32[] calldata proof,
        uint256 deadline,
        bytes calldata sig
    ) external nonReentrant {
        if (msg.sender != user) revert NotSelf();
        bytes32 nullifier = _executeWithdraw(user, token, balance, proof, deadline, sig);
        emit UserWithdrawal(user, token, balance, nullifier);
    }

    /**
     * @dev Shared withdrawal body: Merkle proof, nullifier, EIP-712, reserves, payout to `user`.
     */
    function _executeWithdraw(
        address user,
        address token,
        uint256 balance,
        bytes32[] calldata proof,
        uint256 deadline,
        bytes calldata sig
    ) internal returns (bytes32 nullifier) {
        if (user == address(0)) revert ZeroAddress();
        if (balance == 0) revert ZeroAmount();
        if (deadline < block.timestamp) revert WithdrawExpired();

        bytes32 leaf = _leaf(user, token, balance);
        if (!MerkleProof.verifyCalldata(proof, _merkleRoot, leaf)) revert InvalidMerkleProof();

        nullifier = _nullifier(_merkleRoot, user, token, balance);
        if (_nullifiers[nullifier]) revert NullifierAlreadyUsed();

        if (!_isValidWithdrawSignature(user, token, balance, nullifier, deadline, sig)) {
            revert InvalidSignature();
        }

        if (_reserves[token] < balance) revert InsufficientReserves();

        _nullifiers[nullifier] = true;
        unchecked {
            _reserves[token] -= balance;
        }

        if (token == address(0)) {
            (bool ok, ) = user.call{value: balance}("");
            if (!ok) revert ETHTransferFailed();
        } else {
            IERC20(token).safeTransfer(user, balance);
        }
    }

    /**
     * @notice Returns whether `leaf(user, token, balance)` is included in the tree under the current root.
     * @dev This is a **public** `view` function: callers can probe arbitrary candidates without paying gas via a tx,
     *      but note that `eth_call` still reveals inputs to the node operator.
     * @param user User address encoded in the Merkle leaf.
     * @param token Token address encoded in the Merkle leaf (`address(0)` for ETH).
     * @param balance Balance encoded in the Merkle leaf.
     * @param proof Merkle proof for the leaf.
     * @return ok True if the proof verifies against `_merkleRoot`.
     */
    function verifyBalance(
        address user,
        address token,
        uint256 balance,
        bytes32[] calldata proof
    ) external view returns (bool) {
        bytes32 leaf = _leaf(user, token, balance);
        return MerkleProof.verifyCalldata(proof, _merkleRoot, leaf);
    }

    /**
     * @notice Returns whether a withdrawal nullifier has already been consumed.
     * @param nullifier The nullifier key derived from `(root, user, token, balance)`.
     * @return spent True if already used.
     */
    function isNullifierSpent(bytes32 nullifier) external view returns (bool) {
        return _nullifiers[nullifier];
    }

    /********** ADMIN OPS **********/

    /**
     * @notice Rotates `_admin` to `newAdmin`.
     * @param newAdmin The new admin address (must be non-zero).
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address prev = _admin;
        _admin = newAdmin;
        emit AdminTransferred(prev, newAdmin);
    }

    /**
     * @notice Rotates `_withdrawSigner` to `newSigner`.
     * @param newSigner The new signer address (must be non-zero).
     */
    function setWithdrawSigner(address newSigner) external onlyAdmin {
        if (newSigner == address(0)) revert ZeroAddress();
        _withdrawSigner = newSigner;
        emit WithdrawSignerUpdated(newSigner);
    }

    /**
     * @notice Sweeps only surplus balances (`actualBalance - _reserves[token]`) to `to`.
     * @dev Intended for accidental donations / accounting drift. Cannot move reserved inventory tracked in `_reserves`.
     * @param token Asset key: `address(0)` for native ETH, otherwise an ERC-20 contract address.
     * @param to Recipient of surplus funds (must be non-zero).
     */
    function rescueToken(address token, address to) external onlyAdmin nonReentrant {
        if (to == address(0)) revert ZeroAddress();

        uint256 actual = _actualBalance(token);
        uint256 reserved = _reserves[token];
        if (actual <= reserved) revert NoSurplus();

        uint256 surplus = actual - reserved;

        if (token == address(0)) {
            (bool ok, ) = to.call{value: surplus}("");
            if (!ok) revert ETHTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, surplus);
        }
    }

    /********** INTERNAL HELPERS **********/

    /**
     * @dev Reads the vault’s actual asset balance for `token` (native ETH uses `address(this).balance`).
     */
    function _actualBalance(address token) internal view returns (uint256) {
        if (token == address(0)) {
            return address(this).balance;
        }
        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @dev Computes the Merkle leaf for `(user, token, balance)` using OpenZeppelin `StandardMerkleTree` conventions.
     */
    function _leaf(address user, address token, uint256 balance) internal pure returns (bytes32) {
        // OpenZeppelin StandardMerkleTree leaf hashing convention (double-hash)
        return keccak256(bytes.concat(keccak256(abi.encode(user, token, balance))));
    }

    /**
     * @dev Computes the withdrawal nullifier bound to a specific Merkle `root` and leaf fields.
     */
    function _nullifier(
        bytes32 root,
        address user,
        address token,
        uint256 balance
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(root, user, token, balance));
    }

    /**
     * @dev Validates an EIP-712 signature for `WithdrawAuth` using ECDSA recovery (EOA signer).
     */
    function _isValidWithdrawSignature(
        address user,
        address token,
        uint256 balance,
        bytes32 nullifier,
        uint256 deadline,
        bytes calldata sig
    ) internal view returns (bool) {
        bytes32 structHash = keccak256(
            abi.encode(WITHDRAW_AUTH_TYPEHASH, user, token, balance, nullifier, deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, sig);
        return recovered == _withdrawSigner;
    }
}
