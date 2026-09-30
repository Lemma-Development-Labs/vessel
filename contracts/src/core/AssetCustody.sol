// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStrategyEngine} from "./interfaces/ICore.sol";

/// @title AssetCustody
/// @notice Holds USDC for the book (spec §6). Two compartments are tracked explicitly:
///         `pending` (never-admitted subscriptions, refundable, outside active NAV) and
///         `activeIdle` (admitted capital not currently at the engine). Tokens sent here
///         without going through the controller are quarantined: they are never counted in
///         either compartment, so a donation cannot masquerade as income or capacity.
///         There is no external share, no generic call, and money leaves only to: a request's
///         owner (refund), ClaimEscrow, the engine fixed at deployment, or the fixed treasury.
contract AssetCustody {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public immutable controller;
    address public immutable escrow;
    address public immutable treasury;
    /// @notice Engine allowed to receive deployable capital. Set once by the controller.
    address public engine;

    uint256 public pending;
    uint256 public activeIdle;

    error NotController();
    error EngineAlreadySet();
    error Insufficient();
    error FeeOnTransfer();
    error ZeroAddress();

    event PendingIn(address indexed from, uint256 amount);
    event Admitted(uint256 amount);
    event Refunded(address indexed to, uint256 amount);
    event ContributionIn(address indexed from, uint256 amount);
    event ToEscrow(uint256 amount);
    event ToEngine(uint256 amount);
    event FromEngine(uint256 amount);
    event TreasuryPaid(uint256 amount);

    constructor(IERC20 usdc_, address controller_, address escrow_, address treasury_) {
        if (controller_ == address(0) || escrow_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        usdc = usdc_;
        controller = controller_;
        escrow = escrow_;
        treasury = treasury_;
    }

    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    function setEngine(address engine_) external onlyController {
        if (engine != address(0)) revert EngineAlreadySet();
        if (engine_ == address(0)) revert ZeroAddress();
        engine = engine_;
    }

    /// @notice Tokens held here that no compartment accounts for (donations, mistakes).
    function quarantined() external view returns (uint256) {
        return usdc.balanceOf(address(this)) - pending - activeIdle;
    }

    function receivePending(address from, uint256 amount) external onlyController {
        _pull(from, amount);
        pending += amount;
        emit PendingIn(from, amount);
    }

    function receiveActive(address from, uint256 amount) external onlyController {
        _pull(from, amount);
        activeIdle += amount;
        emit ContributionIn(from, amount);
    }

    function admit(uint256 amount) external onlyController {
        if (amount > pending) revert Insufficient();
        pending -= amount;
        activeIdle += amount;
        emit Admitted(amount);
    }

    function refund(address to, uint256 amount) external onlyController {
        if (amount > pending) revert Insufficient();
        pending -= amount;
        usdc.safeTransfer(to, amount);
        emit Refunded(to, amount);
    }

    function toEscrow(uint256 amount) external onlyController {
        if (amount > activeIdle) revert Insufficient();
        activeIdle -= amount;
        usdc.safeTransfer(escrow, amount);
        emit ToEscrow(amount);
    }

    function toEngine(uint256 amount) external onlyController {
        if (amount > activeIdle) revert Insufficient();
        activeIdle -= amount;
        usdc.safeTransfer(engine, amount);
        IStrategyEngine(engine).credit(amount);
        emit ToEngine(amount);
    }

    /// @notice Ask the engine to release `amount`; only the observed balance increase is credited.
    function fromEngine(uint256 amount) external onlyController {
        uint256 before = usdc.balanceOf(address(this));
        IStrategyEngine(engine).release(amount);
        uint256 received = usdc.balanceOf(address(this)) - before;
        activeIdle += received;
        emit FromEngine(received);
    }

    function payTreasury(uint256 amount) external onlyController {
        if (amount > activeIdle) revert Insufficient();
        activeIdle -= amount;
        usdc.safeTransfer(treasury, amount);
        emit TreasuryPaid(amount);
    }

    function _pull(address from, uint256 amount) private {
        uint256 before = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(from, address(this), amount);
        if (usdc.balanceOf(address(this)) - before != amount) revert FeeOnTransfer();
    }
}
