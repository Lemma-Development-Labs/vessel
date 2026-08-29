// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IGuardian} from "./interfaces/IGuardian.sol";
import {IVenue} from "./interfaces/IVenue.sol";
import {IUniswapV2Router02} from "./interfaces/IUniswapV2Router02.sol";
import {IBlitzVault, ITranches} from "./interfaces/IEngine.sol";

/// @title EngineLite
/// @notice Deploys vault liquidity 50/50 into WMON spot + a venue short, cranks
///         funding + mark PnL into Tranches.settle, and can fully unwind.
/// @dev Spot mark is pool mid (manipulable). Per-crank spot PnL is capped at
///      ±SPOT_PNL_CAP_BPS of the last marked spot value. Real fix = TWAP/oracle.
contract EngineLite is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant SLIPPAGE_BPS = 200; // 2%
    uint256 public constant SWAP_DEADLINE = 300;
    uint256 public constant SPOT_PNL_CAP_BPS = 500; // ±5% of last spot mark per crank

    address public immutable deployer;
    IGuardian public immutable guardian;

    IBlitzVault public vault;
    ITranches public tranches;
    IVenue public venue;
    IUniswapV2Router02 public router;
    address public wmon;
    IERC20 public dUsd;

    bool public wired;
    uint256 public shortId;
    uint256 public lastSpotValue;
    uint256 public lastCrank;

    error NotDeployer();
    error AlreadyWired();
    error NotWired();
    error ZeroAddress();
    error Paused();
    error NothingDeployable();
    error AlreadyDeployed();
    error Slippage();
    error NoPosition();
    error IntOverflow();

    event Wired(address vault, address tranches, address venue, address router, address wmon);
    event LiquidityDeployed(uint256 pulled, uint256 toSpot, uint256 shortId, uint256 wmonOut);
    event Cranked(address indexed caller, int256 grossYield, int256 netDeltaBps);
    event Unwound(uint256 dUsdReturned, int256 closePnl);
    event SpotPnlCapped(int256 uncapped, int256 capped);

    modifier onlyDeployer() {
        if (msg.sender != deployer) revert NotDeployer();
        _;
    }

    modifier whenNotPaused() {
        if (guardian.paused()) revert Paused();
        _;
    }

    constructor(address guardian_) {
        if (guardian_ == address(0)) revert ZeroAddress();
        deployer = msg.sender;
        guardian = IGuardian(guardian_);
    }

    /// @notice Wire dependencies once. Order: vault.setEngine / tranches.setEngine, then this.
    function wire(address vault_, address tranches_, address venue_, address router_, address wmon_)
        external
        onlyDeployer
        whenNotPaused
        nonReentrant
    {
        if (wired) revert AlreadyWired();
        if (
            vault_ == address(0) || tranches_ == address(0) || venue_ == address(0) || router_ == address(0)
                || wmon_ == address(0)
        ) revert ZeroAddress();
        vault = IBlitzVault(vault_);
        tranches = ITranches(tranches_);
        venue = IVenue(venue_);
        router = IUniswapV2Router02(router_);
        wmon = wmon_;
        dUsd = IERC20(IBlitzVault(vault_).asset());
        wired = true;
        lastCrank = block.timestamp;
        emit Wired(vault_, tranches_, venue_, router_, wmon_);
    }

    /// @notice Pull deployable idle, swap half to WMON, open an equal-notional short, keep half as margin.
    function deployLiquidity() external whenNotPaused nonReentrant {
        if (!wired) revert NotWired();
        if (shortId != 0) revert AlreadyDeployed();
        uint256 amount = vault.deployable();
        if (amount < 2) revert NothingDeployable();
        vault.pullForEngine(amount);
        uint256 toSpot = amount / 2;
        uint256 wmonOut = _swap(address(dUsd), wmon, toSpot);
        shortId = venue.openShort(toSpot);
        lastSpotValue = _spotValue();
        lastCrank = block.timestamp;
        emit LiquidityDeployed(amount, toSpot, shortId, wmonOut);
    }

    /// @notice Permissionless. Sweep venue funding, mark spot PnL (capped), settle the waterfall.
    function crank() external whenNotPaused nonReentrant {
        if (!wired) revert NotWired();
        int256 funding;
        if (shortId != 0) {
            dUsd.forceApprove(address(venue), 0);
            dUsd.forceApprove(address(venue), type(uint256).max);
            funding = venue.sweepFunding(shortId);
        }
        if (funding == type(int256).min) revert IntOverflow();
        uint256 spotNow = _spotValue();
        int256 uncapped = _toInt(spotNow) - _toInt(lastSpotValue);
        int256 spotPnl = _capSpotPnl(uncapped, lastSpotValue);
        if (spotPnl != uncapped) emit SpotPnlCapped(uncapped, spotPnl);
        lastSpotValue = spotNow;
        lastCrank = block.timestamp;

        // Solidity 0.8 reverts on int256 overflow — tripwire for a sim/router bug.
        int256 grossYield = funding + spotPnl;
        _handoffYield(funding);
        tranches.settle(grossYield);
        emit Cranked(msg.sender, grossYield, netDeltaBps());
    }

    /// @notice Close the short, swap WMON back to dUSD, return all dUSD to the vault.
    function unwind() external whenNotPaused nonReentrant {
        if (!wired) revert NotWired();
        int256 closePnl;
        if (shortId != 0) {
            dUsd.forceApprove(address(venue), 0);
            dUsd.forceApprove(address(venue), type(uint256).max);
            closePnl = venue.closeShort(shortId);
            shortId = 0;
        }
        uint256 wmonBal = IERC20(wmon).balanceOf(address(this));
        if (wmonBal > 0) {
            _swap(wmon, address(dUsd), wmonBal);
        }
        uint256 cash = dUsd.balanceOf(address(this));
        uint256 dep = vault.deployed();
        if (cash > 0) {
            dUsd.forceApprove(address(vault), 0);
            dUsd.forceApprove(address(vault), cash);
            if (cash >= dep) {
                if (dep > 0) vault.returnFromEngine(dep);
                if (cash > dep) vault.creditYield(cash - dep);
            } else {
                vault.returnFromEngine(cash);
                vault.notifyLoss(dep - cash);
            }
        } else if (dep > 0) {
            vault.notifyLoss(dep);
        }
        lastSpotValue = 0;
        emit Unwound(cash, closePnl);
    }

    /// @notice Signed dUSD difference of (WMON at pool mid) minus short notional.
    function netDelta() public view returns (int256) {
        if (!wired) return 0;
        uint256 spot = _spotValue();
        uint256 shortNotional;
        if (shortId != 0) {
            (shortNotional,) = venue.position(shortId);
        }
        return _toInt(spot) - _toInt(shortNotional);
    }

    /// @notice netDelta as bps of (spot + short notional). 0 if no book.
    function netDeltaBps() public view returns (int256) {
        if (!wired) return 0;
        uint256 spot = _spotValue();
        uint256 shortNotional;
        if (shortId != 0) {
            (shortNotional,) = venue.position(shortId);
        }
        uint256 denom = spot + shortNotional;
        if (denom == 0) return 0;
        return (_toInt(spot) - _toInt(shortNotional)) * int256(BPS) / _toInt(denom);
    }

    function _handoffYield(int256 funding) internal {
        if (funding > 0) {
            uint256 g = uint256(funding);
            uint256 cash = dUsd.balanceOf(address(this));
            uint256 donate = g < cash ? g : cash;
            if (donate > 0) {
                dUsd.forceApprove(address(vault), 0);
                dUsd.forceApprove(address(vault), donate);
                vault.creditYield(donate);
            }
        } else if (funding < 0) {
            uint256 loss = uint256(-funding);
            uint256 dep = vault.deployed();
            uint256 cut = loss < dep ? loss : dep;
            if (cut > 0) vault.notifyLoss(cut);
        }
    }

    function _capSpotPnl(int256 spotPnl, uint256 position) internal pure returns (int256) {
        uint256 cap = (position * SPOT_PNL_CAP_BPS) / BPS;
        if (cap == 0) return 0;
        if (spotPnl > 0 && uint256(spotPnl) > cap) return int256(cap);
        if (spotPnl < 0) {
            uint256 mag = uint256(-spotPnl);
            if (mag > cap) return -int256(cap);
        }
        return spotPnl;
    }

    function _toInt(uint256 x) internal pure returns (int256) {
        if (x > uint256(type(int256).max)) revert IntOverflow();
        return int256(x);
    }

    function _spotValue() internal view returns (uint256) {
        uint256 bal = IERC20(wmon).balanceOf(address(this));
        if (bal == 0) return 0;
        address[] memory path = new address[](2);
        path[0] = wmon;
        path[1] = address(dUsd);
        uint256[] memory amounts = router.getAmountsOut(bal, path);
        return amounts[1];
    }

    function _swap(address tokenIn, address tokenOut, uint256 amountIn) internal returns (uint256 amountOut) {
        IERC20(tokenIn).forceApprove(address(router), 0);
        IERC20(tokenIn).forceApprove(address(router), amountIn);
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        uint256[] memory quoted = router.getAmountsOut(amountIn, path);
        uint256 minOut = (quoted[1] * (BPS - SLIPPAGE_BPS)) / BPS;
        uint256[] memory amounts =
            router.swapExactTokensForTokens(amountIn, minOut, path, address(this), block.timestamp + SWAP_DEADLINE);
        if (amounts[1] < minOut) revert Slippage();
        amountOut = amounts[1];
    }
}
