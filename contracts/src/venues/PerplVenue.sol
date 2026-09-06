// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVenue} from "../interfaces/IVenue.sol";
import {PerplPositionReader} from "./PerplPositionReader.sol";

/// @title PerplVenue
/// @notice Live-market `IVenue` adapter. Records short *intent* on-chain; reads
///         truth from Perpl Exchange via `PerplPositionReader`.
/// @dev A Solidity contract CANNOT open a Perpl position. Orders are signed
///      off-chain (Ed25519 API key over WebSocket) by the keeper. This contract:
///        - `targetShort` / `openShort` → record intent + emit (no order)
///        - `currentShort` / `position` → Exchange truth
///        - `closeShort` / `sweepFunding` → revert (off-chain / custody cycle)
///      Keeper EOA owns the Perpl account. Vessel does not custody venue margin
///      on-chain this cycle.
contract PerplVenue is IVenue {
    uint256 public constant BPS = 10_000;

    PerplPositionReader public immutable reader;
    /// @notice EOA whose Perpl exchange account is the hedge book.
    address public immutable positionOwner;
    /// @notice Published |netDelta|/spotInventory band (bps). Breach ⇒ `assertWithinBand` reverts.
    uint256 public immutable maxDeviationBps;

    int256 public targetNotional;
    uint256 public localShortId;
    bool public targetOpen;

    error ZeroAddress();
    error OrdersOffChainOnly(string action);
    error FundingSweepOffChainOnly();
    error ZeroNotional();
    error UnknownPosition();
    error DeviationBreached(int256 deviationBps, uint256 bandBps);
    error NoSpotInventory();

    event ShortTargetSet(int256 notional, uint256 blockNumber);
    event ShortTargetCleared(uint256 blockNumber);

    constructor(address reader_, address positionOwner_, uint256 maxDeviationBps_) {
        if (reader_ == address(0) || positionOwner_ == address(0)) revert ZeroAddress();
        reader = PerplPositionReader(reader_);
        positionOwner = positionOwner_;
        maxDeviationBps = maxDeviationBps_ == 0 ? 100 : maxDeviationBps_;
    }

    // --------------------------------------------------------------------- //
    // Prompt-02 surface (engine should prefer these; never learns "Perpl")
    // --------------------------------------------------------------------- //

    /// @notice Record desired short notional in quote (CNS). Positive = short that size.
    ///         Does NOT place an order.
    function targetShort(int256 notional) public {
        if (notional == 0) revert ZeroNotional();
        if (notional < 0) revert ZeroNotional(); // short intent is positive magnitude
        targetNotional = notional;
        targetOpen = true;
        if (localShortId == 0) localShortId = 1;
        emit ShortTargetSet(notional, block.number);
    }

    /// @notice Live short notional in quote units (unsigned magnitude) + read block.
    function currentShort() public view returns (uint256 shortNotional, uint256 blockRead) {
        (uint256 id,) = reader.accountId(positionOwner);
        (int256 n, uint256 b) = reader.notionalQuote(id);
        blockRead = b;
        shortNotional = n < 0 ? uint256(-n) : uint256(n);
    }

    /// @notice `spotInventory - abs(currentShort())` in quote units.
    function netDelta(uint256 spotInventory) public view returns (int256 delta, uint256 blockRead) {
        (uint256 shortNotional, uint256 b) = currentShort();
        blockRead = b;
        delta = int256(spotInventory) - int256(shortNotional);
    }

    /// @notice `netDelta / spotInventory` in bps. Reverts only via `assertWithinBand`.
    function deviation(uint256 spotInventory) public view returns (int256 deviationBps, uint256 blockRead) {
        if (spotInventory == 0) revert NoSpotInventory();
        (int256 delta, uint256 b) = netDelta(spotInventory);
        blockRead = b;
        deviationBps = (delta * int256(BPS)) / int256(spotInventory);
    }

    /// @notice View assert used by crank/keeper policy. Breach ⇒ halt path.
    function assertWithinBand(uint256 spotInventory) external view {
        (int256 d,) = deviation(spotInventory);
        uint256 ad = d >= 0 ? uint256(d) : uint256(-d);
        if (ad > maxDeviationBps) revert DeviationBreached(d, maxDeviationBps);
    }

    // --------------------------------------------------------------------- //
    // IVenue — swap-compatible with SimVenue (one contract replace)
    // --------------------------------------------------------------------- //

    /// @inheritdoc IVenue
    /// @dev Records intent only. Keeper must place the Perpl short off-chain.
    function openShort(uint256 notional) external returns (uint256 id) {
        targetShort(int256(notional));
        id = localShortId;
    }

    /// @inheritdoc IVenue
    /// @dev Closing a Perpl position requires an off-chain signed order.
    function closeShort(uint256 id) external returns (int256) {
        if (!targetOpen || id != localShortId) revert UnknownPosition();
        revert OrdersOffChainOnly("closeShort");
    }

    /// @inheritdoc IVenue
    /// @dev Notional + funding from Exchange truth (ignores recorded target).
    function position(uint256 id) external view returns (uint256 notional, int256 fundingAccrued) {
        if (id != 0 && id != localShortId && id != 1) return (0, 0);
        (uint256 acc,) = reader.accountId(positionOwner);
        (,,, int256 funding,) = reader.position(acc);
        (int256 n,) = reader.notionalQuote(acc);
        notional = n < 0 ? uint256(-n) : uint256(n);
        fundingAccrued = funding;
    }

    /// @inheritdoc IVenue
    /// @dev Funding sits on the keeper-owned Perpl account. Sweeping it into the
    ///      vault is not an on-chain Exchange call this cycle — do not fake 0.
    function sweepFunding(uint256) external pure returns (int256) {
        revert FundingSweepOffChainOnly();
    }

    /// @inheritdoc IVenue
    function venueName() external pure returns (string memory) {
        return "PerplVenue";
    }

    /// @inheritdoc IVenue
    function isSimulated() external pure returns (bool) {
        return false;
    }

    /// @notice Clear local intent after the keeper has flattened off-chain.
    function clearTarget() external {
        targetNotional = 0;
        targetOpen = false;
        emit ShortTargetCleared(block.number);
    }
}
