// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IGuardian} from "./interfaces/IGuardian.sol";
import {TrancheToken} from "./TrancheToken.sol";

/// @title Tranches
/// @notice Waterfall brain. HULL is the senior 8% deck; BAL is first-loss ballast.
/// @dev INVARIANT: for every successful settle,
///      ΔhullNAV + ΔbalNAV + Δreserve + Δtreasury == grossYield exactly.
///      Subordination: after any state change, balTvl * 10_000 >= THETA_MIN_BPS * (hullTvl + balTvl),
///      except exits that improve the ratio, which are always allowed.
contract Tranches is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant HULL_RATE_BPS = 800;
    uint256 public constant FEE_BPS = 1_000;
    uint256 public constant RESERVE_TARGET_BPS = 200;
    uint256 public constant THETA_MIN_BPS = 2_000;
    uint256 public constant YEAR = 365 days;
    uint256 public constant BPS = 10_000;
    uint256 public constant SHARES_OFFSET = 1e12; // 6-dec assets → 18-dec shares

    address public immutable deployer;
    IGuardian public immutable guardian;
    IERC20 public immutable asset;
    IERC4626 public immutable vault;
    TrancheToken public immutable hullToken;
    TrancheToken public immutable ballastToken;

    address public engine;
    address public treasury;

    uint256 public hullTvl;
    uint256 public balTvl;
    uint256 public reserve;
    uint256 public treasuryAccrued;
    uint256 public lastSettle;

    error NotDeployer();
    error EngineAlreadySet();
    error NotEngine();
    error ZeroAddress();
    error Paused();
    error SubordinationFloor(uint256 currentBps);
    error HullImpairment();
    error DtZero();
    error ZeroAmount();

    event EngineWired(address indexed engine, uint256 lastSettle);
    event JoinedHull(address indexed user, uint256 assets, uint256 shares);
    event JoinedBallast(address indexed user, uint256 assets, uint256 shares);
    event ExitedHull(address indexed user, uint256 shares, uint256 assets);
    event ExitedBallast(address indexed user, uint256 shares, uint256 assets);
    event TreasuryClaimed(address indexed to, uint256 amount);
    event Waterfall(
        int256 gross,
        uint256 fee,
        uint256 toReserve,
        uint256 toTreasury,
        uint256 hullAccrual,
        uint256 toBallast,
        uint256 fromBallast,
        uint256 fromReserve,
        uint256 hullTvl,
        uint256 balTvl,
        uint256 reserve,
        uint256 ts
    );

    modifier onlyDeployer() {
        if (msg.sender != deployer) revert NotDeployer();
        _;
    }

    modifier onlyEngine() {
        if (msg.sender != engine) revert NotEngine();
        _;
    }

    modifier whenNotPaused() {
        if (guardian.paused()) revert Paused();
        _;
    }

    constructor(address vault_, address guardian_, address treasury_) {
        if (vault_ == address(0) || guardian_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        deployer = msg.sender;
        vault = IERC4626(vault_);
        guardian = IGuardian(guardian_);
        treasury = treasury_;
        asset = IERC20(IERC4626(vault_).asset());
        hullToken = new TrancheToken("Vessel Hull", "HULL");
        ballastToken = new TrancheToken("Vessel Ballast", "BAL");
    }

    /// @notice Wire EngineLite and start the settle clock. Single-use.
    function setEngine(address engine_) external onlyDeployer {
        if (engine != address(0)) revert EngineAlreadySet();
        if (engine_ == address(0)) revert ZeroAddress();
        engine = engine_;
        lastSettle = block.timestamp;
        emit EngineWired(engine_, lastSettle);
    }

    /// @notice Join the Hull deck. Deposits `assets` dUSD into the vault at current Hull NAV.
    function joinHull(uint256 assets) external whenNotPaused nonReentrant returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        uint256 newHull = hullTvl + assets;
        _assertFloor(newHull, balTvl, false);
        _pullAndDeposit(assets);
        shares = _mintDeck(hullToken, hullTvl, assets, msg.sender);
        hullTvl = newHull;
        emit JoinedHull(msg.sender, assets, shares);
    }

    /// @notice Join the Ballast deck. Deposits `assets` dUSD into the vault at current Ballast NAV.
    function joinBallast(uint256 assets) external whenNotPaused nonReentrant returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        uint256 newBal = balTvl + assets;
        _assertFloor(hullTvl, newBal, false);
        _pullAndDeposit(assets);
        shares = _mintDeck(ballastToken, balTvl, assets, msg.sender);
        balTvl = newBal;
        emit JoinedBallast(msg.sender, assets, shares);
    }

    /// @notice Exit Hull. Always allowed when it improves the ballast ratio.
    function exitHull(uint256 shares) external whenNotPaused nonReentrant returns (uint256 assetsOut) {
        if (shares == 0) revert ZeroAmount();
        uint256 supply = hullToken.totalSupply();
        assetsOut = (shares * hullTvl) / supply;
        uint256 newHull = hullTvl - assetsOut;
        _assertFloor(newHull, balTvl, true);
        hullToken.burn(msg.sender, shares);
        hullTvl = newHull;
        _withdrawTo(msg.sender, assetsOut);
        emit ExitedHull(msg.sender, shares, assetsOut);
    }

    /// @notice Exit Ballast. Reverts SubordinationFloor if the exit would breach 20%.
    function exitBallast(uint256 shares) external whenNotPaused nonReentrant returns (uint256 assetsOut) {
        if (shares == 0) revert ZeroAmount();
        uint256 supply = ballastToken.totalSupply();
        assetsOut = (shares * balTvl) / supply;
        uint256 newBal = balTvl - assetsOut;
        _assertFloor(hullTvl, newBal, true);
        ballastToken.burn(msg.sender, shares);
        balTvl = newBal;
        _withdrawTo(msg.sender, assetsOut);
        emit ExitedBallast(msg.sender, shares, assetsOut);
    }

    /// @notice Settle gross yield from EngineLite. See contract NatSpec for the invariant.
    function settle(int256 grossYield) external onlyEngine whenNotPaused nonReentrant {
        uint256 dt = block.timestamp - lastSettle;
        if (dt == 0) revert DtZero();
        lastSettle = block.timestamp;

        uint256 fee;
        uint256 toReserve;
        uint256 toTreasury;
        uint256 hullAccrual;
        uint256 toBallast;
        uint256 fromBallast;
        uint256 fromReserve;

        if (grossYield > 0) {
            uint256 g = uint256(grossYield);
            fee = (g * FEE_BPS) / BPS;
            uint256 userTvl = hullTvl + balTvl;
            uint256 target = (userTvl * RESERVE_TARGET_BPS) / BPS;
            if (reserve < target) {
                toReserve = fee / 2;
            }
            toTreasury = fee - toReserve;
            uint256 remainder = g - fee;
            uint256 hullTarget = (hullTvl * HULL_RATE_BPS * dt) / (BPS * YEAR);
            hullAccrual = hullTarget < remainder ? hullTarget : remainder;
            toBallast = remainder - hullAccrual;

            // If hull-heavy accrual would breach the floor, spill the excess to ballast.
            uint256 newHull = hullTvl + hullAccrual;
            uint256 newBal = balTvl + toBallast;
            if (_breaches(newHull, newBal) && hullAccrual > 0) {
                uint256 spill = _spillToKeepFloor(newHull, newBal, hullAccrual);
                hullAccrual -= spill;
                toBallast += spill;
            }

            hullTvl += hullAccrual;
            balTvl += toBallast;
            reserve += toReserve;
            treasuryAccrued += toTreasury;
        } else if (grossYield < 0) {
            uint256 loss = uint256(-grossYield);
            if (loss > balTvl + reserve) revert HullImpairment();
            if (loss <= balTvl) {
                fromBallast = loss;
                balTvl -= loss;
            } else {
                fromBallast = balTvl;
                fromReserve = loss - balTvl;
                balTvl = 0;
                reserve -= fromReserve;
            }
        }

        emit Waterfall(
            grossYield,
            fee,
            toReserve,
            toTreasury,
            hullAccrual,
            toBallast,
            fromBallast,
            fromReserve,
            hullTvl,
            balTvl,
            reserve,
            block.timestamp
        );
    }

    /// @notice Pull-payment of accrued protocol fees to the treasury address.
    function claimTreasury() external whenNotPaused nonReentrant {
        uint256 amt = treasuryAccrued;
        if (amt == 0) return;
        treasuryAccrued = 0;
        _withdrawTo(treasury, amt);
        emit TreasuryClaimed(treasury, amt);
    }

    /// @notice Snapshot used by the app multicall.
    function deckStats()
        external
        view
        returns (
            uint256 hullTvl_,
            uint256 balTvl_,
            uint256 reserve_,
            uint256 treasuryAccrued_,
            uint256 hullSupply,
            uint256 balSupply,
            uint256 lastSettle_,
            uint256 thetaBps
        )
    {
        hullTvl_ = hullTvl;
        balTvl_ = balTvl;
        reserve_ = reserve;
        treasuryAccrued_ = treasuryAccrued;
        hullSupply = hullToken.totalSupply();
        balSupply = ballastToken.totalSupply();
        lastSettle_ = lastSettle;
        thetaBps = _ratioBps(hullTvl, balTvl);
    }

    function _pullAndDeposit(uint256 assets) internal {
        asset.safeTransferFrom(msg.sender, address(this), assets);
        asset.safeIncreaseAllowance(address(vault), assets);
        vault.deposit(assets, address(this));
    }

    function _withdrawTo(address to, uint256 assetsOut) internal {
        vault.withdraw(assetsOut, to, address(this));
    }

    function _mintDeck(TrancheToken token, uint256 tvlBefore, uint256 assets, address to)
        internal
        returns (uint256 shares)
    {
        uint256 supply = token.totalSupply();
        if (supply == 0 || tvlBefore == 0) {
            shares = assets * SHARES_OFFSET;
        } else {
            shares = (assets * supply) / tvlBefore;
        }
        token.mint(to, shares);
    }

    function _ratioBps(uint256 h, uint256 b) internal pure returns (uint256) {
        uint256 sum = h + b;
        if (sum == 0) return BPS;
        return (b * BPS) / sum;
    }

    function _breaches(uint256 h, uint256 b) internal pure returns (bool) {
        uint256 sum = h + b;
        if (sum == 0) return false;
        return b * BPS < THETA_MIN_BPS * sum;
    }

    function _assertFloor(uint256 newH, uint256 newB, bool isExit) internal view {
        if (!_breaches(newH, newB)) return;
        if (isExit) {
            uint256 oldBps = _ratioBps(hullTvl, balTvl);
            uint256 newBps = _ratioBps(newH, newB);
            if (newBps >= oldBps) return; // exit improves (or holds) the ratio
        }
        revert SubordinationFloor(_ratioBps(newH, newB));
    }

    function _spillToKeepFloor(uint256 newH, uint256 newB, uint256 hullAccrual) internal pure returns (uint256 spill) {
        // Need newB * BPS >= THETA_MIN * (newH + newB)
        // Spill s from hull to bal: (newB+s)*BPS >= THETA * (newH-s + newB+s) = THETA*(newH+newB)
        uint256 sum = newH + newB;
        uint256 needB = (THETA_MIN_BPS * sum + BPS - 1) / BPS;
        if (needB <= newB) return 0;
        spill = needB - newB;
        if (spill > hullAccrual) spill = hullAccrual;
    }
}
