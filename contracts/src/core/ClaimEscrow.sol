// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPauseGuardian} from "./interfaces/ICore.sol";

/// @title ClaimEscrow
/// @notice Holds USDC already funded for claims (spec §6). It cannot lend, deploy or redirect
///         it: money leaves only to a pool's fixed receiver, or — for pooled Hull series — to a
///         holder the controller has computed an entitlement for. Segregated in its own
///         contract so claimable funds can never be counted as, or traded with, active assets.
contract ClaimEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 internal constant CLAIMS = 8;

    IERC20 public immutable usdc;
    IPauseGuardian public immutable pauses;
    address public immutable controller;

    /// @notice Balance funded into each pool (a Ballast exit, a refund, or a Hull series).
    mapping(bytes32 => uint256) public poolBalance;
    /// @notice Fixed receiver of a pool; zero for a pooled Hull series paid via the controller.
    mapping(bytes32 => address) public receiverOf;
    uint256 public totalFunded;

    error NotController();
    error ClaimsPaused();
    error ReceiverMismatch();
    error Insufficient();
    error Unbacked();
    error NothingToClaim();

    event Funded(bytes32 indexed key, address indexed receiver, uint256 amount);
    event Paid(bytes32 indexed key, address indexed to, uint256 amount);

    constructor(IERC20 usdc_, IPauseGuardian pauses_, address controller_) {
        usdc = usdc_;
        pauses = pauses_;
        controller = controller_;
    }

    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    /// @notice Record `amount` already transferred in by AssetCustody. Reverts if the escrow's
    ///         token balance does not back every funded pool.
    function fund(bytes32 key, address receiver, uint256 amount) external onlyController {
        address fixedTo = receiverOf[key];
        if (fixedTo == address(0)) receiverOf[key] = receiver;
        else if (fixedTo != receiver) revert ReceiverMismatch();
        poolBalance[key] += amount;
        totalFunded += amount;
        if (usdc.balanceOf(address(this)) < totalFunded) revert Unbacked();
        emit Funded(key, receiver, amount);
    }

    /// @notice Anyone may trigger payment of a fixed-receiver pool; funds go only to its receiver.
    function claim(bytes32 key) external nonReentrant returns (uint256 amount) {
        if (pauses.isPaused(CLAIMS)) revert ClaimsPaused();
        address to = receiverOf[key];
        amount = poolBalance[key];
        if (to == address(0) || amount == 0) revert NothingToClaim();
        _pay(key, to, amount);
    }

    /// @notice Pooled Hull payout computed by the controller from cumulative per-unit accounting.
    function release(bytes32 key, address to, uint256 amount) external onlyController nonReentrant {
        if (pauses.isPaused(CLAIMS)) revert ClaimsPaused();
        if (receiverOf[key] != address(0)) revert ReceiverMismatch();
        _pay(key, to, amount);
    }

    function _pay(bytes32 key, address to, uint256 amount) private {
        if (amount > poolBalance[key]) revert Insufficient();
        poolBalance[key] -= amount;
        totalFunded -= amount;
        usdc.safeTransfer(to, amount);
        emit Paid(key, to, amount);
    }
}
