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
contract BlitzVault is ERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant DEPLOYABLE_BPS = 9_000;
    uint256 public constant BPS = 10_000;

    address public immutable deployer;
    IGuardian public immutable guardian;

    address public engine;
    uint256 public deployed;

    error NotDeployer();
    error EngineAlreadySet();
    error NotEngine();
    error ZeroAddress();
    error Paused();
    error InsufficientIdle();
    error LossExceedsDeployed();

    event EngineSet(address indexed engine);
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

    modifier whenNotPaused() {
        if (guardian.paused()) revert Paused();
        _;
    }

    constructor(IERC20 dUsd, address guardian_) ERC20("Vessel Blitz Shares", "vBLITZ") ERC4626(dUsd) {
        if (guardian_ == address(0)) revert ZeroAddress();
        deployer = msg.sender;
        guardian = IGuardian(guardian_);
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
    function setEngine(address engine_) external onlyDeployer {
        if (engine != address(0)) revert EngineAlreadySet();
        if (engine_ == address(0)) revert ZeroAddress();
        engine = engine_;
        emit EngineSet(engine_);
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
    function returnFromEngine(uint256 amount) external onlyEngine whenNotPaused nonReentrant {
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        if (amount >= deployed) deployed = 0;
        else deployed -= amount;
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

    function deposit(uint256 assets, address receiver) public override whenNotPaused nonReentrant returns (uint256) {
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override whenNotPaused nonReentrant returns (uint256) {
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
