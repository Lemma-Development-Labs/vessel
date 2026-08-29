// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUniswapV2Router02} from "../interfaces/IUniswapV2Router02.sol";
import {MockWMON} from "./MockWMON.sol";
import {Decimals} from "../lib/Decimals.sol";

/// @title MockRouter
/// @notice 1:1 UniswapV2-compatible router for tests and sim deploys.
///         1 dUSD (6dec) ↔ 1 WMON (18dec) i.e. amount * 1e12.
contract MockRouter is IUniswapV2Router02 {
    using SafeERC20 for IERC20;

    IERC20 public immutable dUsd;
    MockWMON public immutable wmon;

    error BadPath();
    error Expired();
    error InsufficientOutput();

    constructor(address dUsd_, address wmon_) {
        dUsd = IERC20(dUsd_);
        wmon = MockWMON(wmon_);
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts) {
        amounts = _quote(amountIn, path);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        if (block.timestamp > deadline) revert Expired();
        amounts = _quote(amountIn, path);
        if (amounts[1] < amountOutMin) revert InsufficientOutput();
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        if (path[0] == address(dUsd) && path[1] == address(wmon)) {
            wmon.mint(to, amounts[1]);
        } else if (path[0] == address(wmon) && path[1] == address(dUsd)) {
            wmon.burn(address(this), amountIn);
            dUsd.safeTransfer(to, amounts[1]);
        } else {
            revert BadPath();
        }
    }

    function _quote(uint256 amountIn, address[] calldata path) internal view returns (uint256[] memory amounts) {
        if (path.length != 2) revert BadPath();
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        if (path[0] == address(dUsd) && path[1] == address(wmon)) {
            amounts[1] = Decimals.dusdToWmon(amountIn);
        } else if (path[0] == address(wmon) && path[1] == address(dUsd)) {
            amounts[1] = Decimals.wmonToDusdDown(amountIn);
        } else {
            revert BadPath();
        }
    }
}
