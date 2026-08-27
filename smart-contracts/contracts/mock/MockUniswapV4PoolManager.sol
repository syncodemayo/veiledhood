// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

/**
 * @title MockUniswapV4PoolManager
 * @notice Test double for a Uniswap V4 PoolManager. Implements the unlock→callback→settle/take
 *         pattern used by VeilSwap. Returns a fixed `_amountOut` for every swap regardless of
 *         pool or params. Pre-fund the mock with the output token/ETH before calling any swap.
 */
contract MockUniswapV4PoolManager {
    using SafeERC20 for IERC20;

    uint256 private _amountOut;

    constructor(uint256 fixedAmountOut_) {
        _amountOut = fixedAmountOut_;
    }

    function setFixedAmountOut(uint256 amount) external {
        _amountOut = amount;
    }

    receive() external payable {}

    // ── IPoolManager surface used by VeilSwap ─────────────────────────────────

    /// @notice Triggers IUnlockCallback on the caller, mirroring the real PoolManager.
    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    /// @notice Returns a BalanceDelta encoding amountIn as a debt and _amountOut as a credit.
    function swap(
        PoolKey calldata,
        SwapParams calldata params,
        bytes calldata
    ) external view returns (BalanceDelta) {
        // amountSpecified is negative (exact-input), so the input amount is its absolute value.
        int128 amountIn  = int128(uint128(uint256(-params.amountSpecified)));
        int128 amountOut = int128(uint128(_amountOut));

        // From VeilSwap's perspective:
        //   negative delta = owes the pool (tokenIn)
        //   positive delta = pool owes VeilSwap (tokenOut)
        if (params.zeroForOne) {
            // tokenIn = currency0, tokenOut = currency1
            return toBalanceDelta(-amountIn, amountOut);
        } else {
            // tokenIn = currency1, tokenOut = currency0
            return toBalanceDelta(amountOut, -amountIn);
        }
    }

    /// @notice Snapshot currency balance before ERC-20 settlement (no-op in mock).
    function sync(Currency) external {}

    /// @notice Accepts ETH (native currency settlement) or finalises ERC-20 settlement.
    function settle() external payable returns (uint256) {
        return msg.value;
    }

    /// @notice Sends `amount` of `currency` to `to`.
    function take(Currency currency, address to, uint256 amount) external {
        address token = Currency.unwrap(currency);
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "MockPM: ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
