// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPerplExchange} from "../../src/interfaces/IPerplExchange.sol";

/// @title MockPerplExchange
/// @notice Test double for Perpl Exchange position reads. No order placement.
contract MockPerplExchange is IPerplExchange {
    error AccountMissing(address who);

    mapping(address => AccountInfo) internal byAddr;
    mapping(uint256 => AccountInfo) internal byId;
    mapping(uint256 => mapping(uint256 => PositionInfo)) internal posByPerpAccount;
    mapping(uint256 => mapping(uint256 => uint256)) internal marks;
    mapping(uint256 => mapping(uint256 => bool)) internal markOk;
    uint256 public nextAccountId = 1;

    function setAccount(address owner, uint256 balanceCNS) external returns (uint256 id) {
        id = nextAccountId++;
        AccountInfo memory info = AccountInfo({
            accountId: id,
            balanceCNS: balanceCNS,
            lockedBalanceCNS: 0,
            frozen: 0,
            accountAddr: owner,
            positions: PositionBitMap(0, 0, 0, 0)
        });
        byAddr[owner] = info;
        byId[id] = info;
    }

    function setPosition(
        uint256 perpId,
        uint256 accountId_,
        uint8 positionType,
        uint256 depositCNS,
        uint256 pricePNS,
        uint256 lotLNS,
        int256 premiumPnlCNS
    ) external {
        posByPerpAccount[perpId][accountId_] = PositionInfo({
            accountId: accountId_,
            nextNodeId: 0,
            prevNodeId: 0,
            positionType: positionType,
            depositCNS: depositCNS,
            pricePNS: pricePNS,
            lotLNS: lotLNS,
            entryBlock: block.number,
            pnlCNS: 0,
            deltaPnlCNS: 0,
            premiumPnlCNS: premiumPnlCNS
        });
        marks[perpId][accountId_] = pricePNS;
        markOk[perpId][accountId_] = true;
    }

    function clearPosition(uint256 perpId, uint256 accountId_) external {
        delete posByPerpAccount[perpId][accountId_];
    }

    function getAccountByAddr(address accountAddress) external view returns (AccountInfo memory accountInfo) {
        accountInfo = byAddr[accountAddress];
        if (accountInfo.accountId == 0) revert AccountMissing(accountAddress);
    }

    function getAccountById(uint256 accountId_) external view returns (AccountInfo memory accountInfo) {
        accountInfo = byId[accountId_];
        if (accountInfo.accountId == 0) revert AccountMissing(address(0));
    }

    function getPosition(uint256 perpId, uint256 accountId_)
        external
        view
        returns (PositionInfo memory positionInfo, uint256 markPricePNS, bool markPriceValid)
    {
        positionInfo = posByPerpAccount[perpId][accountId_];
        markPricePNS = marks[perpId][accountId_];
        markPriceValid = markOk[perpId][accountId_];
    }
}
