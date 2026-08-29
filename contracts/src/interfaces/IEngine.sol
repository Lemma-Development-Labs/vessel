// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBlitzVault {
    function asset() external view returns (address);
    function deployable() external view returns (uint256);
    function deployed() external view returns (uint256);
    function pullForEngine(uint256 amount) external;
    function returnFromEngine(uint256 amount) external;
    function creditYield(uint256 amount) external;
    function notifyLoss(uint256 amount) external;
    function totalAssets() external view returns (uint256);
}

interface ITranches {
    function settle(int256 grossYield) external;
    function asset() external view returns (address);
}
