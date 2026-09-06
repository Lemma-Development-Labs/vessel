// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPerplExchange
/// @notice Minimal read surface of the Perpl Exchange proxy on Monad testnet.
/// @dev ABI verified 2026-09-06 against PerplFoundation/dex-sdk `Exchange.json`
///      and live `cast call` on `0x1964c32f0be608e7d29302aff5e61268e72080cc`.
///      Orders are NOT placed through this interface — only account/position reads.
interface IPerplExchange {
    /// @dev On-chain PositionEnum: Long = 0, Short = 1 (perpl-sdk PositionType).
    struct PositionInfo {
        uint256 accountId;
        uint256 nextNodeId;
        uint256 prevNodeId;
        uint8 positionType;
        uint256 depositCNS;
        uint256 pricePNS;
        uint256 lotLNS;
        uint256 entryBlock;
        int256 pnlCNS;
        int256 deltaPnlCNS;
        int256 premiumPnlCNS;
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

    /// @notice Reverts when no exchange account exists for `accountAddress`.
    function getAccountByAddr(address accountAddress) external view returns (AccountInfo memory accountInfo);

    function getAccountById(uint256 accountId) external view returns (AccountInfo memory accountInfo);

    /// @notice Position for (`perpId`, `accountId`). Empty lots ⇒ no open position.
    function getPosition(uint256 perpId, uint256 accountId)
        external
        view
        returns (PositionInfo memory positionInfo, uint256 markPricePNS, bool markPriceValid);
}
