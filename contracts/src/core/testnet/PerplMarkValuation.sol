// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEngineValuation, IPerplExchange} from "../interfaces/IVenues.sol";

/// @title PerplMarkValuation — TESTNET ONLY, NOT INDEPENDENT
/// @notice Prices for HedgedEngine on Monad testnet. MON/USD is the Perpl mark of the hedged
///         perpetual; AUSD/USDC is taken at par. Neither is the independent valuation the spec
///         requires (G03): the mark comes from the venue the engine trades on, and par is an
///         assumption. `isIndependent()` is always false and the constructor refuses Monad
///         mainnet (chain 143), so a mainnet engine must be built on an approved feed instead.
contract PerplMarkValuation is IEngineValuation {
    uint256 public constant PAR = 1e18;

    IPerplExchange public immutable exchange;
    uint256 public immutable perpId;
    /// @dev 10 ** the perpetual's priceDecimals, read once at deployment.
    uint256 public immutable priceScale;

    error Mainnet();
    error UnknownPerp();

    constructor(IPerplExchange exchange_, uint256 perpId_) {
        if (block.chainid == 143) revert Mainnet();
        exchange = exchange_;
        perpId = perpId_;
        IPerplExchange.PerpetualInfoV2 memory p = exchange_.getPerpetualInfoV2(perpId_);
        if (p.markPNS == 0 || p.priceDecimals > 18) revert UnknownPerp();
        priceScale = 10 ** p.priceDecimals;
    }

    /// @inheritdoc IEngineValuation
    /// @dev observedAt is the mark's own timestamp, so the controller's staleness check applies to it.
    function prices() external view returns (uint256 monUsdcE18, uint256 ausdUsdcE18, uint256 observedAt) {
        IPerplExchange.PerpetualInfoV2 memory p = exchange.getPerpetualInfoV2(perpId);
        return ((p.markPNS * 1e18) / priceScale, PAR, p.markTimestamp);
    }

    function isIndependent() external pure returns (bool) {
        return false;
    }
}
