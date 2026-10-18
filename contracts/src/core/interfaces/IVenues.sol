// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The Perpl Exchange surface the engine uses. Signatures from PerplFoundation/dex-sdk
///         `crates/sdk/abi/dex/Exchange.json` (REVISION rc_v1.1.7-203-g0e5902dd); every selector
///         was checked present in the testnet implementation on 2026-10-05 (FACT_CHECKS.md).
interface IPerplExchange {
    struct OrderDesc {
        uint256 orderDescId;
        uint256 perpId;
        uint8 orderType; // 0 OpenLong, 1 OpenShort, 2 CloseLong, 3 CloseShort
        uint256 orderId;
        uint256 pricePNS;
        uint256 lotLNS;
        uint256 expiryBlock;
        bool postOnly;
        bool fillOrKill;
        bool immediateOrCancel;
        uint256 maxMatches;
        uint256 leverageHdths;
        uint256 lastExecutionBlock;
        uint256 amountCNS;
        uint256 maxNegPnlCollatBPS;
    }

    struct OrderSignature {
        uint256 perpId;
        uint256 orderId;
    }

    struct PositionBitMap {
        uint256 bank1;
        uint256 bank2;
        uint256 bank3;
        uint256 bank4;
    }

    struct AccountInfo {
        uint256 accountId;
        uint256 balanceCNS;
        uint256 lockedBalanceCNS;
        uint8 frozen;
        address accountAddr;
        PositionBitMap positions;
    }

    struct PositionInfo {
        uint256 accountId;
        uint256 nextNodeId;
        uint256 prevNodeId;
        uint8 positionType; // 0 Long, 1 Short
        uint256 depositCNS;
        uint256 pricePNS;
        uint256 lotLNS;
        uint256 entryBlock;
        int256 pnlCNS; // marked: deltaPnlCNS + premiumPnlCNS (funding)
        int256 deltaPnlCNS;
        int256 premiumPnlCNS;
    }

    struct PerpetualInfoV2 {
        string name;
        string symbol;
        uint256 priceDecimals;
        uint256 lotDecimals;
        bytes32 linkFeedId;
        uint256 priceTolPer100K;
        uint256 marginTol;
        uint256 marginTolDecimals;
        uint256 refPriceMaxAgeSec;
        uint256 positionBalanceCNS;
        uint256 insuranceBalanceCNS;
        uint256 markPNS;
        uint256 markTimestamp;
        uint256 lastPNS;
        uint256 lastTimestamp;
        uint256 oraclePNS;
        uint256 oracleTimestampSec;
        uint256 longOpenInterestLNS;
        uint256 shortOpenInterestLNS;
        uint256 fundingStartBlock;
        int16 fundingRatePct100k;
        uint256 absFundingClampPctPer100K;
        uint8 status;
        uint256 basePricePNS;
        uint256 maxBidPriceONS;
        uint256 minBidPriceONS;
        uint256 maxAskPriceONS;
        uint256 minAskPriceONS;
        uint256 numOrders;
        bool ignOracle;
        uint256 fundingSumScalingExp;
    }

    function createAccount(uint256 amountCNS) external returns (uint256 accountId);
    function depositCollateral(uint256 amountCNS) external;
    function withdrawCollateral(uint256 amountCNS) external;
    function execOrder(OrderDesc calldata orderDesc) external returns (OrderSignature memory);
    function getAccountByAddr(address accountAddress) external view returns (AccountInfo memory);
    function getPosition(uint256 perpId, uint256 accountId)
        external
        view
        returns (PositionInfo memory positionInfo, uint256 markPricePNS, bool markPriceValid);
    function getPerpetualInfoV2(uint256 perpId) external view returns (PerpetualInfoV2 memory);
    function getExchangeInfo()
        external
        view
        returns (
            uint256 balanceCNS,
            uint256 protocolBalanceCNS,
            uint256 recycleBalanceCNS,
            uint256 collateralDecimals,
            address collateralToken,
            address verifierProxy
        );
}

/// @notice Kuru order book (one market). docs.kuru.io/contracts/OrderBook.
interface IKuruOrderBook {
    /// @dev Field order as returned on chain (checked on testnet MON-USDC 2026-10-05).
    function getMarketParams()
        external
        view
        returns (
            uint32 pricePrecision,
            uint96 sizePrecision,
            address baseAsset,
            uint256 baseAssetDecimals,
            address quoteAsset,
            uint256 quoteAssetDecimals,
            uint32 tickSize,
            uint96 minSize,
            uint96 maxSize,
            uint256 takerFeeBps,
            uint256 makerFeeBps
        );

    /// @dev `minOut` is uint256 in the deployed bytecode (the docs say uint96; selectors checked 2026-10-05).
    /// @param quoteSize quote amount scaled by pricePrecision (not token units)
    /// @return baseOut base received, in base token units (native MON: wei)
    function placeAndExecuteMarketBuy(uint96 quoteSize, uint256 minOut, bool isMargin, bool isFillOrKill)
        external
        payable
        returns (uint256 baseOut);

    /// @param size base amount scaled by sizePrecision; for native base, msg.value carries it
    /// @return quoteOut quote received, in quote token units
    function placeAndExecuteMarketSell(uint96 size, uint256 minOut, bool isMargin, bool isFillOrKill)
        external
        payable
        returns (uint256 quoteOut);
}

/// @notice Kuru Router. docs.kuru.io/contracts/Router.
interface IKuruRouter {
    function anyToAnySwap(
        address[] calldata marketAddresses,
        bool[] calldata isBuy,
        bool[] calldata nativeSend,
        address debitToken,
        address creditToken,
        uint256 amount,
        uint256 minAmountOut
    ) external payable returns (uint256 amountOut);
}

/// @notice Prices the engine values its holdings with. Mainnet needs an approved independent
///         source (G03); the testnet adapter reads the Perpl mark and says so.
interface IEngineValuation {
    /// @return monUsdcE18 USDC per 1 MON, 1e18-scaled
    /// @return ausdUsdcE18 USDC per 1 AUSD, 1e18-scaled
    /// @return observedAt timestamp the prices were observed at
    function prices() external view returns (uint256 monUsdcE18, uint256 ausdUsdcE18, uint256 observedAt);

    function isIndependent() external view returns (bool);
}
