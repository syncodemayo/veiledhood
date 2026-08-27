// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

/**
 * @title LiquidityHelper
 * @notice Test utility — initializes a Uniswap V4 pool and adds liquidity.
 *         Pre-fund this contract with tokens before calling addLiquidity.
 */
contract LiquidityHelper is IUnlockCallback {
    IPoolManager public immutable poolManager;

    constructor(address pm) {
        poolManager = IPoolManager(pm);
    }

    receive() external payable {}

    /// @notice Initialise a new pool. Can be called directly (no unlock needed).
    function initializePool(PoolKey calldata key, uint160 sqrtPriceX96) external returns (int24 tick) {
        return poolManager.initialize(key, sqrtPriceX96);
    }

    /// @notice Add liquidity to an already-initialised pool.
    ///         Caller must have pre-funded this contract with sufficient tokens.
    function addLiquidity(
        PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta
    ) external payable {
        poolManager.unlock(abi.encode(key, tickLower, tickUpper, liquidityDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "LH: not PM");

        (PoolKey memory key, int24 tickLower, int24 tickUpper, int256 liquidityDelta) =
            abi.decode(data, (PoolKey, int24, int24, int256));

        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower:       tickLower,
                tickUpper:       tickUpper,
                liquidityDelta:  liquidityDelta,
                salt:            bytes32(0)
            }),
            ""
        );

        // Negative delta = we owe the pool (pay it). Positive = pool owes us (take it).
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();

        if (d0 < 0) _settle(key.currency0, uint256(uint128(-d0)));
        if (d1 < 0) _settle(key.currency1, uint256(uint128(-d1)));
        if (d0 > 0) poolManager.take(key.currency0, address(this), uint256(uint128(d0)));
        if (d1 > 0) poolManager.take(key.currency1, address(this), uint256(uint128(d1)));

        return "";
    }

    function _settle(Currency currency, uint256 amount) internal {
        address token = Currency.unwrap(currency);
        if (token == address(0)) {
            poolManager.settle{value: amount}();
        } else {
            poolManager.sync(currency);
            IERC20(token).transfer(address(poolManager), amount);
            poolManager.settle();
        }
    }
}
