// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVenue} from "../interfaces/IVenue.sol";

/// @title SimVenue
/// @notice SIMULATED VENUE — same interface Perpl will implement; exists so hedge
///         accounting is demonstrable today. Owner seeds a dUSD pot. Funding
///         accrues linearly on open notional at `fundingRateBps` (default 1200).
contract SimVenue is IVenue {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant YEAR = 365 days;
    int256 public constant DEFAULT_RATE_BPS = 1_200;
    uint256 public constant MAX_RATE_BPS = 10_000; // tripwire, not economics

    address public immutable owner;
    IERC20 public immutable dUsd;

    int256 public fundingRateBps = DEFAULT_RATE_BPS;
    uint256 public nextId = 1;

    struct Pos {
        address opener;
        uint256 notional;
        uint256 lastAccrual;
        bool open;
    }

    mapping(uint256 => Pos) public positions;

    error NotOwner();
    error UnknownPosition();
    error Closed();
    error ZeroNotional();
    error InsufficientPot();
    error InsufficientMargin();
    error ImplausibleRate();

    event Seeded(address indexed from, uint256 amount);
    event RateSet(int256 rateBps);
    event ShortOpened(uint256 indexed id, address indexed opener, uint256 notional);
    event ShortClosed(uint256 indexed id, int256 pnl);
    event FundingSwept(uint256 indexed id, int256 realized);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address dUsd_) {
        owner = msg.sender;
        dUsd = IERC20(dUsd_);
    }

    /// @notice Seed the dUSD pot used to pay positive funding.
    function seed(uint256 amount) external {
        dUsd.safeTransferFrom(msg.sender, address(this), amount);
        emit Seeded(msg.sender, amount);
    }

    /// @notice Set the simulated funding rate. May be negative for the bad-day demo.
    function setFundingRateBps(int256 rateBps) external onlyOwner {
        if (rateBps == type(int256).min) revert ImplausibleRate();
        if (_abs(rateBps) > MAX_RATE_BPS) revert ImplausibleRate();
        fundingRateBps = rateBps;
        emit RateSet(rateBps);
    }

    /// @inheritdoc IVenue
    function openShort(uint256 notional) external returns (uint256 id) {
        if (notional == 0) revert ZeroNotional();
        id = nextId++;
        positions[id] = Pos({opener: msg.sender, notional: notional, lastAccrual: block.timestamp, open: true});
        emit ShortOpened(id, msg.sender, notional);
    }

    /// @inheritdoc IVenue
    function closeShort(uint256 id) external returns (int256 pnl) {
        Pos storage p = positions[id];
        if (!p.open) revert UnknownPosition();
        if (p.opener != msg.sender) revert UnknownPosition();
        pnl = _accrued(p);
        p.open = false;
        p.notional = 0;
        p.lastAccrual = block.timestamp;
        _settle(msg.sender, pnl);
        emit ShortClosed(id, pnl);
        emit FundingSwept(id, pnl);
    }

    /// @inheritdoc IVenue
    function position(uint256 id) external view returns (uint256 notional, int256 fundingAccrued) {
        Pos storage p = positions[id];
        if (!p.open) return (0, 0);
        return (p.notional, _accrued(p));
    }

    /// @inheritdoc IVenue
    function sweepFunding(uint256 id) external returns (int256 realized) {
        Pos storage p = positions[id];
        if (!p.open) revert UnknownPosition();
        if (p.opener != msg.sender) revert UnknownPosition();
        realized = _accrued(p);
        p.lastAccrual = block.timestamp;
        _settle(msg.sender, realized);
        emit FundingSwept(id, realized);
    }

    /// @inheritdoc IVenue
    function venueName() external pure returns (string memory) {
        return "SimVenue";
    }

    /// @inheritdoc IVenue
    function isSimulated() external pure returns (bool) {
        return true;
    }

    function _accrued(Pos storage p) internal view returns (int256) {
        uint256 dt = block.timestamp - p.lastAccrual;
        if (dt == 0 || p.notional == 0 || fundingRateBps == 0) return 0;
        // Linear: notional * rateBps * dt / (BPS * YEAR). Signed via rate.
        uint256 mag = (p.notional * _abs(fundingRateBps) * dt) / (BPS * YEAR);
        if (fundingRateBps < 0) return -int256(mag);
        return int256(mag);
    }

    function _settle(address to, int256 pnl) internal {
        if (pnl > 0) {
            uint256 pay = uint256(pnl);
            if (dUsd.balanceOf(address(this)) < pay) revert InsufficientPot();
            dUsd.safeTransfer(to, pay);
        } else if (pnl < 0) {
            uint256 take = uint256(-pnl);
            dUsd.safeTransferFrom(to, address(this), take);
        }
    }

    function _abs(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }
}
