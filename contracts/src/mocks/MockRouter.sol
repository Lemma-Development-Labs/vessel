// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRouter} from "../interfaces/IRouter.sol";
import {MockWMON} from "./MockWMON.sol";
import {Decimals} from "../lib/Decimals.sol";

/// @title MockRouter
/// @notice 1:1 IRouter for tests and sim deploys. 1 quote (6dec) ↔ 1 WMON (18dec).
contract MockRouter is IRouter {
    using SafeERC20 for IERC20;

    IERC20 public immutable quoteToken;
    MockWMON public immutable baseToken;

    error Expired();
    error InsufficientOutput();
    error ZeroAmount();
    error DecimalsMismatch(uint8 gotQuote, uint8 gotBase);

    constructor(address quoteToken_, address baseToken_) {
        if (IERC20Metadata(quoteToken_).decimals() != 6) {
            revert DecimalsMismatch(IERC20Metadata(quoteToken_).decimals(), 0);
        }
        if (IERC20Metadata(baseToken_).decimals() != 18) {
            revert DecimalsMismatch(0, IERC20Metadata(baseToken_).decimals());
        }
        quoteToken = IERC20(quoteToken_);
        baseToken = MockWMON(baseToken_);
    }

    /// @inheritdoc IRouter
    function quoteExactQuoteForBase(uint256 quoteIn) external pure returns (uint256) {
        return Decimals.dusdToWmon(quoteIn);
    }

    /// @inheritdoc IRouter
    function quoteExactBaseForQuote(uint256 baseIn) external pure returns (uint256) {
        return Decimals.wmonToDusdDown(baseIn);
    }

    /// @inheritdoc IRouter
    function swapExactQuoteForBase(uint256 quoteIn, uint256 minBaseOut, uint256 deadline)
        external
        returns (uint256 baseOut)
    {
        if (block.timestamp > deadline) revert Expired();
        if (quoteIn == 0) revert ZeroAmount();
        if (minBaseOut == 0) revert InsufficientOutput();
        baseOut = Decimals.dusdToWmon(quoteIn);
        if (baseOut < minBaseOut) revert InsufficientOutput();
        quoteToken.safeTransferFrom(msg.sender, address(this), quoteIn);
        baseToken.mint(msg.sender, baseOut);
    }

    /// @inheritdoc IRouter
    function swapExactBaseForQuote(uint256 baseIn, uint256 minQuoteOut, uint256 deadline)
        external
        returns (uint256 quoteOut)
    {
        if (block.timestamp > deadline) revert Expired();
        if (baseIn == 0) revert ZeroAmount();
        if (minQuoteOut == 0) revert InsufficientOutput();
        quoteOut = Decimals.wmonToDusdDown(baseIn);
        if (quoteOut < minQuoteOut) revert InsufficientOutput();
        // Pull WMON then burn via router privilege.
        IERC20(address(baseToken)).safeTransferFrom(msg.sender, address(this), baseIn);
        baseToken.burn(address(this), baseIn);
        quoteToken.safeTransfer(msg.sender, quoteOut);
    }
}
