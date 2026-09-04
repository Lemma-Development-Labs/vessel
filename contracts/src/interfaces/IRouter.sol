// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IRouter
/// @notice Spot swap surface for EngineLite. Quote and base are fixed by the
///         implementation (MockRouter: dUSD↔WMON; KuruRouter: Kuru USDC↔WMON).
/// @dev minOut is always caller-supplied. Implementations must never default it
///      to zero or a magic constant.
interface IRouter {
    /// @notice Preview base received for `quoteIn` quote tokens (no state change).
    function quoteExactQuoteForBase(uint256 quoteIn) external view returns (uint256 baseOut);

    /// @notice Preview quote received for `baseIn` base tokens (no state change).
    function quoteExactBaseForQuote(uint256 baseIn) external view returns (uint256 quoteOut);

    /// @notice Pull `quoteIn` from caller, swap to base, send base to caller.
    /// @param minBaseOut Caller-computed floor. Revert if fill is worse.
    function swapExactQuoteForBase(uint256 quoteIn, uint256 minBaseOut, uint256 deadline)
        external
        returns (uint256 baseOut);

    /// @notice Pull `baseIn` from caller, swap to quote, send quote to caller.
    /// @param minQuoteOut Caller-computed floor. Revert if fill is worse.
    function swapExactBaseForQuote(uint256 baseIn, uint256 minQuoteOut, uint256 deadline)
        external
        returns (uint256 quoteOut);
}
