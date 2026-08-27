// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

/**
 * @title VeilSwap
 * @notice Pooled custody vault for ERC-20 + native ETH with off-chain ledger committed via Merkle root,
 *         extended with admin-driven shielded swaps via Uniswap V4.
 *
 * @dev Same Merkle + nullifier + EIP-712 pattern as Veiledhood. The admin calls `adminExecuteSwap` to:
 *   1. Consume a user's `(user, tokenIn, amountIn)` Merkle leaf.
 *   2. Route the swap through the Uniswap V4 PoolManager via the unlock→callback pattern.
 *   3. Credit `amountOut` of `tokenOut` to `_reserves`.
 *   4. Emit `SwapExecuted` so the off-chain indexer updates the user's DB balance.
 *
 *      The backend then rebuilds the Merkle tree (user now holds tokenOut) and commits a new root.
 *      Finally, the admin calls `adminWithdraw` to pay the user their tokenOut balance.
 *
 * @custom:merkle OpenZeppelin `StandardMerkleTree` leaf encoding (double-hash):
 *   `leaf = keccak256(bytes.concat(keccak256(abi.encode(user, token, balance))))`.
 *
 * @custom:nullifier `nullifier = keccak256(abi.encode(root, user, token, balance))`.
 */
contract VeilSwap is ReentrancyGuard, EIP712, IUnlockCallback {
    using SafeERC20 for IERC20;

    /********** EVENTS **********/
    event Deposited(address indexed depositor, address indexed token, uint256 amount);
    event MerkleRootUpdated(bytes32 indexed newRoot);
    event AdminWithdrawal(address indexed user, address indexed token, uint256 amount, bytes32 nullifier);
    event UserWithdrawal(address indexed user, address indexed token, uint256 amount, bytes32 nullifier);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event WithdrawSignerUpdated(address indexed newSigner);

    /// @notice Emitted after a successful `adminExecuteSwap`.
    event SwapExecuted(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bytes32 nullifier
    );

    /********** ERRORS **********/
    error OnlyAdmin();
    error NotSelf();
    error NotPoolManager();
    error ZeroAddress();
    error ZeroAmount();
    error MsgValueMismatch();
    error InvalidMerkleProof();
    error NullifierAlreadyUsed();
    error WithdrawExpired();
    error InvalidSignature();
    error InsufficientReserves();
    error ETHTransferFailed();
    error NoSurplus();
    error InvalidPath();
    error SlippageExceeded();

    /********** CONSTANTS **********/
    bytes32 private constant WITHDRAW_AUTH_TYPEHASH =
        keccak256(
            "WithdrawAuth(address user,address token,uint256 balance,bytes32 nullifier,uint256 deadline)"
        );

    /// @dev sqrtPriceLimitX96 extremes — allow swap to execute at any price, then check amountOutMin.
    uint160 private constant MIN_SQRT_PRICE_LIMIT = 4295128740;
    uint160 private constant MAX_SQRT_PRICE_LIMIT = 1461446703485210103287273052203988822378723970341;

    /********** IMMUTABLES **********/
    IPoolManager public immutable poolManager;

    /********** STATE **********/
    bytes32 private _merkleRoot;
    address private _admin;
    address private _withdrawSigner;
    mapping(address token => uint256) private _reserves;
    mapping(bytes32 nullifier => bool) private _nullifiers;

    /********** MODIFIERS **********/
    modifier onlyAdmin() {
        if (msg.sender != _admin) revert OnlyAdmin();
        _;
    }

    /**
     * @param initialAdmin          Initial `_admin`.
     * @param initialWithdrawSigner Initial `_withdrawSigner` (may equal `initialAdmin`).
     * @param poolManager_          Uniswap V4 PoolManager address.
     */
    constructor(
        address initialAdmin,
        address initialWithdrawSigner,
        address poolManager_
    ) EIP712("VeilSwap", "1") {
        if (
            initialAdmin == address(0) ||
            initialWithdrawSigner == address(0) ||
            poolManager_ == address(0)
        ) revert ZeroAddress();
        _admin = initialAdmin;
        _withdrawSigner = initialWithdrawSigner;
        poolManager = IPoolManager(poolManager_);
    }

    /********** DEPOSITS **********/

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

    /// @dev Accepts ETH without reverting — required so the V4 PoolManager can return native ETH
    ///      to this contract via `take(NATIVE, address(this), amount)`.
    receive() external payable {}

    /********** MERKLE ROOT **********/

    function updateMerkleRoot(bytes32 newRoot) external onlyAdmin {
        if (newRoot == bytes32(0)) revert ZeroAddress();
        _merkleRoot = newRoot;
        emit MerkleRootUpdated(newRoot);
    }

    function getMerkleRoot() external view returns (bytes32) {
        return _merkleRoot;
    }

    /********** SWAP **********/

    /**
     * @notice Admin executes a shielded swap on behalf of `user` via Uniswap V4.
     * @dev Verifies the user's `(user, tokenIn, amountIn)` Merkle leaf, then routes through
     *      the V4 PoolManager unlock→callback pattern (single-hop, exact-input).
     *      The off-chain indexer listens for `SwapExecuted` to update the DB balance and
     *      commit a new Merkle root.
     *
     * @param user         User whose tokenIn leaf is being consumed.
     * @param tokenIn      Input asset (`address(0)` for native ETH).
     * @param tokenOut     Output asset (`address(0)` for native ETH).
     * @param amountIn     Must match the user's committed Merkle leaf balance.
     * @param amountOutMin Minimum output amount (slippage protection).
     * @param poolKey      Uniswap V4 PoolKey identifying the pool to swap in.
     *                     `poolKey.currency0` and `poolKey.currency1` must correspond to
     *                     `tokenIn` and `tokenOut` (in either order).
     * @param proof        Merkle proof for `leaf(user, tokenIn, amountIn)`.
     * @param deadline     Swap expiry timestamp.
     */
    function adminExecuteSwap(
        address user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        PoolKey calldata poolKey,
        bytes32[] calldata proof,
        uint256 deadline
    ) external onlyAdmin nonReentrant {
        if (user == address(0)) revert ZeroAddress();
        if (amountIn == 0) revert ZeroAmount();
        if (deadline < block.timestamp) revert WithdrawExpired();

        // Validate poolKey currencies match tokenIn/tokenOut
        address c0 = Currency.unwrap(poolKey.currency0);
        address c1 = Currency.unwrap(poolKey.currency1);
        if ((c0 != tokenIn && c1 != tokenIn) || (c0 != tokenOut && c1 != tokenOut)) revert InvalidPath();

        bool zeroForOne = (c0 == tokenIn);

        bytes32 leaf = _leaf(user, tokenIn, amountIn);
        if (!MerkleProof.verifyCalldata(proof, _merkleRoot, leaf)) revert InvalidMerkleProof();

        if (_reserves[tokenIn] < amountIn) revert InsufficientReserves();

        unchecked {
            _reserves[tokenIn] -= amountIn;
        }

        // Execute swap via V4 unlock→callback; amountOut is returned through the unlock call.
        // _reserves[tokenOut] is incremented inside unlockCallback before returning.
        bytes memory result = poolManager.unlock(
            abi.encode(tokenIn, tokenOut, amountIn, amountOutMin, poolKey, zeroForOne)
        );
        uint256 amountOut = abi.decode(result, (uint256));

        emit SwapExecuted(user, tokenIn, tokenOut, amountIn, amountOut, bytes32(0));
    }

    /********** V4 UNLOCK CALLBACK **********/

    /**
     * @notice Called by the V4 PoolManager during `unlock`. Executes the swap, settles debts,
     *         and takes the output tokens back to this contract.
     * @dev Only the PoolManager may call this function.
     */
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();

        (
            address tokenIn,
            address tokenOut,
            uint256 amountIn,
            uint256 amountOutMin,
            PoolKey memory key,
            bool zeroForOne
        ) = abi.decode(data, (address, address, uint256, uint256, PoolKey, bool));

        // Execute the swap in the PoolManager; exact-input → amountSpecified is negative.
        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne:        zeroForOne,
                amountSpecified:   -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE_LIMIT : MAX_SQRT_PRICE_LIMIT
            }),
            "" // no hook data
        );

        // delta.amount0 / delta.amount1 represent the change from VeilSwap's perspective.
        // Negative = we owe the pool; positive = pool owes us.
        int128 rawOut = zeroForOne ? delta.amount1() : delta.amount0();
        if (rawOut <= 0) revert SlippageExceeded();
        uint256 amountOut = uint256(uint128(rawOut));
        if (amountOut < amountOutMin) revert SlippageExceeded();

        // ── Settle tokenIn (pay what we owe the pool) ──────────────────────────
        if (tokenIn == address(0)) {
            // Native ETH: single call with value
            poolManager.settle{value: amountIn}();
        } else {
            // ERC-20: sync snapshot → transfer → confirm
            poolManager.sync(Currency.wrap(tokenIn));
            IERC20(tokenIn).safeTransfer(address(poolManager), amountIn);
            poolManager.settle();
        }

        // ── Take tokenOut (collect what pool owes us) ───────────────────────────
        poolManager.take(Currency.wrap(tokenOut), address(this), amountOut);

        // Credit reserves here so adminExecuteSwap can read the final amountOut after unlock returns.
        _reserves[tokenOut] += amountOut;

        return abi.encode(amountOut);
    }

    /********** WITHDRAWALS **********/

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

    function verifyBalance(
        address user,
        address token,
        uint256 balance,
        bytes32[] calldata proof
    ) external view returns (bool) {
        return MerkleProof.verifyCalldata(proof, _merkleRoot, _leaf(user, token, balance));
    }

    function isNullifierSpent(bytes32 nullifier) external view returns (bool) {
        return _nullifiers[nullifier];
    }

    function getReserves(address token) external view returns (uint256) {
        return _reserves[token];
    }

    /********** ADMIN OPS **********/

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        address prev = _admin;
        _admin = newAdmin;
        emit AdminTransferred(prev, newAdmin);
    }

    function setWithdrawSigner(address newSigner) external onlyAdmin {
        if (newSigner == address(0)) revert ZeroAddress();
        _withdrawSigner = newSigner;
        emit WithdrawSignerUpdated(newSigner);
    }

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

    /********** INTERNAL **********/

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

    function _actualBalance(address token) internal view returns (uint256) {
        if (token == address(0)) return address(this).balance;
        return IERC20(token).balanceOf(address(this));
    }

    function _leaf(address user, address token, uint256 balance) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(user, token, balance))));
    }

    function _nullifier(bytes32 root, address user, address token, uint256 balance) internal pure returns (bytes32) {
        return keccak256(abi.encode(root, user, token, balance));
    }

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
