// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPerplExchange} from "../interfaces/IPerplExchange.sol";

/// @title PerplPositionReader
/// @notice On-chain position reader for Perpl Exchange. Does not place orders.
/// @dev Every successful getter returns the block it read at (`block.number` —
///      Monad proposed/"latest" state; see MONSKILLS concepts/block-states).
///      Fields that are not exposed on the Exchange revert `FieldNotOnChain`
///      instead of returning a fabricated zero.
contract PerplPositionReader {
    /// @dev On-chain PositionEnum (perpl-sdk PositionType): Long=0, Short=1.
    uint8 internal constant POSITION_LONG = 0;
    uint8 internal constant POSITION_SHORT = 1;

    /// @notice Collateral decimals for CNS amounts (Perpl testnet aUSD / docs).
    uint256 public constant COLLATERAL_DECIMALS = 6;

    IPerplExchange public immutable exchange;
    uint256 public immutable marketId;
    /// @notice From `getPerpetualInfo` / pub context — MON market 64: priceDecimals=5, lotDecimals=0.
    uint256 public immutable priceDecimals;
    uint256 public immutable lotDecimals;

    error ZeroAddress();
    error FieldNotOnChain(string field);
    error UnknownPositionType(uint8 positionType);
    error BadDecimals();

    /// @param priceDecimals_ Verified live for the market (MON=5). Passed in so we do not
    ///        depend on the large `getPerpetualInfo` tuple ABI staying byte-stable.
    /// @param lotDecimals_ Verified live for the market (MON=0).
    constructor(address exchange_, uint256 marketId_, uint256 priceDecimals_, uint256 lotDecimals_) {
        if (exchange_ == address(0)) revert ZeroAddress();
        if (priceDecimals_ > COLLATERAL_DECIMALS) revert BadDecimals();
        exchange = IPerplExchange(exchange_);
        marketId = marketId_;
        priceDecimals = priceDecimals_;
        lotDecimals = lotDecimals_;
    }

    /// @notice Exchange account id for `owner`, or 0 when absent (never reverts).
    /// @dev Live ABI returns AccountInfo (not bare uint256). Api-docs README cast
    ///      snippet that decodes as `(uint256)` is incomplete — see session notes.
    function accountId(address owner) external view returns (uint256 id, uint256 blockRead) {
        blockRead = block.number;
        id = _accountId(owner);
    }

    /// @notice Live position for `accountId_` on `marketId`.
    /// @return size Signed lot size (Short ⇒ negative, Long ⇒ positive). 0 if flat.
    /// @return entryPx Entry price in PNS.
    /// @return margin Locked deposit in CNS (6dec collateral).
    /// @return fundingAccrued Premium/funding PnL in CNS (`premiumPnlCNS` on Exchange).
    /// @return blockRead `block.number` of this read.
    function position(uint256 accountId_)
        external
        view
        returns (int256 size, uint256 entryPx, uint256 margin, int256 fundingAccrued, uint256 blockRead)
    {
        blockRead = block.number;
        if (accountId_ == 0) {
            return (0, 0, 0, 0, blockRead);
        }
        (IPerplExchange.PositionInfo memory info,,) = exchange.getPosition(marketId, accountId_);
        if (info.lotLNS == 0) {
            return (0, 0, 0, 0, blockRead);
        }
        size = _signedSize(info.positionType, info.lotLNS);
        entryPx = info.pricePNS;
        margin = info.depositCNS;
        // premiumPnlCNS is the on-chain funding/premium accrual (perpl-sdk Position.premium_pnl).
        fundingAccrued = info.premiumPnlCNS;
    }

    /// @notice Short/long notional in collateral units (CNS, 6dec).
    /// @dev Flat position returns 0. Sign matches `position().size` (short negative).
    function notionalQuote(uint256 accountId_) external view returns (int256 notional, uint256 blockRead) {
        blockRead = block.number;
        if (accountId_ == 0) return (0, blockRead);
        (IPerplExchange.PositionInfo memory info,,) = exchange.getPosition(marketId, accountId_);
        if (info.lotLNS == 0) return (0, blockRead);
        uint256 mag = _notionalCNS(info.lotLNS, info.pricePNS);
        int256 signedLots = _signedSize(info.positionType, info.lotLNS);
        notional = signedLots < 0 ? -int256(mag) : int256(mag);
    }

    /// @notice Liquidation band / liq price is NOT a field on PositionInfo.
    /// @dev Docs describe maintenance-margin liquidation mechanics but do not expose a
    ///      per-position liquidation price on the Exchange read ABI. Do not invent one.
    function liquidationPrice(uint256) external pure returns (uint256) {
        revert FieldNotOnChain("liquidationPrice");
    }

    function _accountId(address owner) internal view returns (uint256 id) {
        try exchange.getAccountByAddr(owner) returns (IPerplExchange.AccountInfo memory info) {
            return info.accountId;
        } catch {
            return 0;
        }
    }

    function _signedSize(uint8 positionType, uint256 lotLNS) internal pure returns (int256) {
        if (positionType == POSITION_LONG) return int256(lotLNS);
        if (positionType == POSITION_SHORT) return -int256(lotLNS);
        revert UnknownPositionType(positionType);
    }

    function _notionalCNS(uint256 lotLNS, uint256 pricePNS) internal view returns (uint256) {
        // notional = lot * price * 10^(collateralDecimals - priceDecimals) / 10^lotDecimals
        uint256 scale = 10 ** (COLLATERAL_DECIMALS - priceDecimals);
        uint256 num = lotLNS * pricePNS * scale;
        if (lotDecimals == 0) return num;
        return num / (10 ** lotDecimals);
    }
}
