// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStrategyEngine} from "../interfaces/ICore.sol";

/// @title SimulatedEngine — TESTNET ONLY, SIMULATED
/// @notice Stands in for the MON spot + Perpl short engine on Monad testnet (ADR-008, G01 BLOCKED).
///         It holds the book's deployed test dollars and simulates funding: a signed annual rate
///         (set by governance) accrues on the deployed balance, paid from / into a seeded pot.
///         There is no spot leg, no short, and no real venue. `isSimulated()` is always true and
///         the constructor refuses Monad mainnet (chain 143); the mainnet manifest guard also
///         rejects any contract named Sim*.
contract SimulatedEngine is IStrategyEngine {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant YEAR = 365 days;
    int256 public constant MAX_RATE_BPS = 10_000; // tripwire, not economics

    IERC20 public immutable asset;
    address public immutable custody;
    address public immutable governance;

    /// @notice Test dollars attributed to the book (excludes the pot).
    uint256 public book;
    /// @notice Test dollars available to pay positive funding; receives negative funding.
    uint256 public pot;
    int256 public fundingRateBps;
    uint256 public lastAccrual;

    error NotCustody();
    error NotGovernance();
    error ImplausibleRate();
    error Insufficient();
    error Mainnet();

    event Seeded(address indexed from, uint256 amount);
    event RateSet(int256 rateBps);
    event Accrued(int256 funding, uint256 book, uint256 pot);
    event Released(uint256 amount);

    constructor(IERC20 asset_, address custody_, address governance_) {
        if (block.chainid == 143) revert Mainnet();
        asset = asset_;
        custody = custody_;
        governance = governance_;
        lastAccrual = block.timestamp;
    }

    function isSimulated() external pure returns (bool) {
        return true;
    }

    function setFundingRateBps(int256 rateBps) external {
        if (msg.sender != governance) revert NotGovernance();
        if (rateBps > MAX_RATE_BPS || rateBps < -MAX_RATE_BPS) revert ImplausibleRate();
        accrue();
        fundingRateBps = rateBps;
        emit RateSet(rateBps);
    }

    /// @notice Anyone may add test dollars to the funding pot.
    function seed(uint256 amount) external {
        asset.safeTransferFrom(msg.sender, address(this), amount);
        pot += amount;
        emit Seeded(msg.sender, amount);
    }

    /// @notice Funding accrued since the last accrual, bounded by what the pot (or book) can pay.
    function pendingFunding() public view returns (int256) {
        uint256 dt = block.timestamp - lastAccrual;
        if (dt == 0 || book == 0 || fundingRateBps == 0) return 0;
        uint256 mag = (book * uint256(fundingRateBps > 0 ? fundingRateBps : -fundingRateBps) * dt) / (BPS * YEAR);
        if (fundingRateBps > 0) return int256(mag < pot ? mag : pot);
        return -int256(mag < book ? mag : book);
    }

    /// @notice Settle simulated funding between pot and book. Permissionless.
    function accrue() public {
        int256 f = pendingFunding();
        lastAccrual = block.timestamp;
        if (f > 0) {
            pot -= uint256(f);
            book += uint256(f);
        } else if (f < 0) {
            book -= uint256(-f);
            pot += uint256(-f);
        }
        if (f != 0) emit Accrued(f, book, pot);
    }

    /// @inheritdoc IStrategyEngine
    /// @dev Value includes funding accrued up to this block, so settlement sees it continuously.
    function value() external view returns (uint256, uint256) {
        int256 f = pendingFunding();
        uint256 v = f >= 0 ? book + uint256(f) : book - uint256(-f);
        return (v, block.timestamp);
    }

    /// @inheritdoc IStrategyEngine
    function credit(uint256 amount) external {
        if (msg.sender != custody) revert NotCustody();
        accrue();
        if (asset.balanceOf(address(this)) < book + pot + amount) revert Insufficient();
        book += amount;
    }

    /// @notice Tokens held that are neither book nor pot (donations, mistakes). Never valued.
    function quarantined() external view returns (uint256) {
        return asset.balanceOf(address(this)) - book - pot;
    }

    /// @inheritdoc IStrategyEngine
    function release(uint256 amount) external {
        if (msg.sender != custody) revert NotCustody();
        accrue();
        if (amount > book) revert Insufficient();
        book -= amount;
        asset.safeTransfer(custody, amount);
        emit Released(amount);
    }
}
