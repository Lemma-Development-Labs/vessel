// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IGuardian} from "./interfaces/IGuardian.sol";

/// @title BlitzVault
/// @notice ERC-4626 vault over dUSD. 90% of assets are deployable to EngineLite;
///         10% stays as idle buffer. Engine pull/return is wire-once.
/// @dev Share issuance is closed: only `tranches` may call `deposit`/`mint`, and the
///      protocol dead-share seed is a one-shot `seedDeadShares`. This is a solvency
///      requirement, not just access control — Tranches keeps an asset-denominated book
///      that it redeems through its own vBLITZ, while `creditYield` raises the share
///      price for *every* holder. An outside shareholder would therefore capture a
///      pro-rata slice of yield that Tranches has already credited to Hull/Ballast in
///      full, leaving its book unredeemable (see test/unit/Inflation.t.sol).
///
///      Virtual-share offset is 6 (`_decimalsOffset`) plus the 100 dUSD dead-share seed.
///      Together they make the classic first-depositor inflation attack unprofitable.
contract BlitzVault is ERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant DEPLOYABLE_BPS = 9_000;
    uint256 public constant BPS = 10_000;
    uint8 public constant DECIMALS_OFFSET = 6;

    /// @notice Burn address that holds the protocol dead-share seed.
    address public constant DEAD = address(0x000000000000000000000000000000000000dEaD);

    address public immutable deployer;
    IGuardian public immutable guardian;

    address public engine;
    address public tranches;
    bool public deadSharesSeeded;
    uint256 public deployed;

    error NotDeployer();
    error EngineAlreadySet();
    error NotEngine();
    error NotTranches();
    error TranchesAlreadySet();
    error DeadSharesAlreadySeeded();
    error DeadSharesNotSeeded();
    error ZeroAmount();
    error ZeroAddress();
    error Paused();
    error InsufficientIdle();
    error LossExceedsDeployed();

    event EngineSet(address indexed engine);
    event TranchesSet(address indexed tranches);
    event DeadSharesSeeded(uint256 assets, uint256 shares);
    event Pulled(uint256 amount, uint256 deployed);
    event Returned(uint256 amount, uint256 deployed);
    event YieldCredited(uint256 amount);
    event LossNotified(uint256 amount, uint256 deployed);

    modifier onlyDeployer() {
        if (msg.sender != deployer) revert NotDeployer();
        _;
    }

    modifier onlyEngine() {
        if (msg.sender != engine) revert NotEngine();
        _;
    }

    modifier onlyTranches() {
        if (msg.sender != tranches) revert NotTranches();
        _;
    }

    modifier whenNotPaused() {
        if (guardian.paused()) revert Paused();
        _;
    }

    constructor(IERC20 dUsd, address guardian_) ERC20("Vessel Blitz Shares", "vBLITZ") ERC4626(dUsd) {
        if (guardian_ == address(0)) revert ZeroAddress();
        deployer = msg.sender;
        guardian = IGuardian(guardian_);
    }

    /// @dev OZ virtual-share mitigation. 10^6 virtual shares vs +1 virtual asset.
    function _decimalsOffset() internal pure override returns (uint8) {
        return DECIMALS_OFFSET;
    }

    /// @notice Assets currently managed by the vault, including amounts at the engine.
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + deployed;
    }

    /// @notice 90% of totalAssets minus already-deployed. Idle buffer is the remainder.
    function deployable() public view returns (uint256) {
        uint256 maxDeploy = (totalAssets() * DEPLOYABLE_BPS) / BPS;
        if (deployed >= maxDeploy) return 0;
        return maxDeploy - deployed;
    }

    /// @notice Wire EngineLite. Single-use. Cannot be called by Guardian.
    function setEngine(address engine_) external onlyDeployer whenNotPaused nonReentrant {
        if (engine != address(0)) revert EngineAlreadySet();
        if (engine_ == address(0)) revert ZeroAddress();
        engine = engine_;
        emit EngineSet(engine_);
    }

    /// @notice Mint the one-time protocol dead-share seed to `DEAD`. Deployer only, single-use.
    /// @dev The ERC-4626 inflation-attack mitigation, paired with `_decimalsOffset() = 6`.
    ///      Deployer must have approved `amount` of the asset to this vault. Must run before
    ///      `setTranches`, so the vault can never be opened for business unseeded.
    function seedDeadShares(uint256 amount) external onlyDeployer whenNotPaused nonReentrant returns (uint256 shares) {
        if (deadSharesSeeded) revert DeadSharesAlreadySeeded();
        if (amount == 0) revert ZeroAmount();
        deadSharesSeeded = true;
        shares = previewDeposit(amount);
        _deposit(msg.sender, DEAD, amount, shares);
        emit DeadSharesSeeded(amount, shares);
    }

    /// @notice Wire Tranches, the only address allowed to mint vBLITZ. Single-use.
    /// @dev Requires the dead-share seed to already exist, so the first Tranches deposit
    ///      can never be the vault's first deposit.
    function setTranches(address tranches_) external onlyDeployer whenNotPaused nonReentrant {
        if (tranches != address(0)) revert TranchesAlreadySet();
        if (tranches_ == address(0)) revert ZeroAddress();
        if (!deadSharesSeeded) revert DeadSharesNotSeeded();
        tranches = tranches_;
        emit TranchesSet(tranches_);
    }

    /// @notice Transfer `amount` dUSD to the engine and mark it deployed. Engine only.
    function pullForEngine(uint256 amount) external onlyEngine whenNotPaused nonReentrant {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (amount > idle) revert InsufficientIdle();
        deployed += amount;
        IERC20(asset()).safeTransfer(engine, amount);
        emit Pulled(amount, deployed);
    }

    /// @notice Engine returns `amount` dUSD of previously deployed principal.
    /// @dev Effects before interaction: `deployed` is reduced, then tokens are pulled.
    function returnFromEngine(uint256 amount) external onlyEngine whenNotPaused nonReentrant {
        if (amount >= deployed) deployed = 0;
        else deployed -= amount;
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        emit Returned(amount, deployed);
    }

    /// @notice Engine donates realized yield dUSD. Does not change `deployed`. Share price rises.
    function creditYield(uint256 amount) external onlyEngine whenNotPaused nonReentrant {
        if (amount == 0) return;
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        emit YieldCredited(amount);
    }

    /// @notice Engine realized a loss already paid out of deployed capital. Drops `deployed`.
    function notifyLoss(uint256 amount) external onlyEngine whenNotPaused nonReentrant {
        if (amount > deployed) revert LossExceedsDeployed();
        deployed -= amount;
        emit LossNotified(amount, deployed);
    }

    /// @notice Deposit assets for vBLITZ. Restricted to `tranches` — see contract NatSpec.
    /// @dev Share issuance is closed so that Tranches' asset-denominated book stays fully
    ///      redeemable from the vBLITZ it holds. `previewDeposit`/`previewMint` stay open.
    function deposit(uint256 assets, address receiver)
        public
        override
        onlyTranches
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        return super.deposit(assets, receiver);
    }

    /// @notice Mint vBLITZ for assets. Restricted to `tranches` — see `deposit`.
    function mint(uint256 shares, address receiver)
        public
        override
        onlyTranches
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        return super.withdraw(assets, receiver, owner_);
    }

    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256)
    {
        return super.redeem(shares, receiver, owner_);
    }
}
