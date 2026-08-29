// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DemoUSD} from "../../src/DemoUSD.sol";
import {Guardian} from "../../src/guards/Guardian.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {Tranches} from "../../src/Tranches.sol";
import {SimVenue} from "../../src/venues/SimVenue.sol";
import {EngineLite} from "../../src/EngineLite.sol";
import {MockWMON} from "../../src/mocks/MockWMON.sol";
import {MockRouter} from "../../src/mocks/MockRouter.sol";

contract Fixture is Test {
    DemoUSD internal dusd;
    Guardian internal guardian;
    BlitzVault internal vault;
    Tranches internal tranches;
    SimVenue internal venue;
    EngineLite internal engine;
    MockWMON internal wmon;
    MockRouter internal router;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");

    function _deploy() internal {
        vm.startPrank(owner);
        dusd = new DemoUSD();
        guardian = new Guardian(owner);
        vault = new BlitzVault(dusd, address(guardian));
        tranches = new Tranches(address(vault), address(guardian), treasury);
        venue = new SimVenue(address(dusd));
        wmon = new MockWMON();
        router = new MockRouter(address(dusd), address(wmon));
        wmon.setRouter(address(router));
        engine = new EngineLite(address(guardian));
        vault.setEngine(address(engine));
        tranches.setEngine(address(engine));
        engine.wire(address(vault), address(tranches), address(venue), address(router), address(wmon));
        vm.stopPrank();
        _seedDeadShares();
        vm.prank(owner);
        vault.setTranches(address(tranches));
    }

    address internal constant DEAD = address(0x000000000000000000000000000000000000dEaD);

    /// @dev 100 dUSD protocol-owned dead shares. Paired with `_decimalsOffset() = 6`.
    ///      Must precede `setTranches` — the vault enforces that ordering.
    function _seedDeadShares() internal {
        _faucet(owner, 1);
        vm.startPrank(owner);
        dusd.approve(address(vault), 100e6);
        vault.seedDeadShares(100e6);
        vm.stopPrank();
    }

    function _faucet(address user, uint256 times) internal {
        uint256 t = block.timestamp;
        for (uint256 i; i < times; i++) {
            t += 1 hours;
            vm.warp(t);
            vm.prank(user);
            dusd.faucet();
        }
    }

    function _approveTranches(address user, uint256 amount) internal {
        vm.prank(user);
        dusd.approve(address(tranches), amount);
    }

    /// @dev Impersonate the wired Tranches to reach the vault's own 4626 entry points.
    ///      Only for vault-level unit tests. The product path is joinHull / joinBallast.
    function _vaultDepositAsTranches(uint256 assets, address receiver) internal returns (uint256 shares) {
        deal(address(dusd), address(tranches), dusd.balanceOf(address(tranches)) + assets, true);
        vm.startPrank(address(tranches));
        dusd.approve(address(vault), assets);
        shares = vault.deposit(assets, receiver);
        vm.stopPrank();
    }

    /// @dev Same as `_vaultDepositAsTranches` but through `mint`.
    function _vaultMintAsTranches(uint256 shares, address receiver) internal returns (uint256 assets) {
        uint256 cost = vault.previewMint(shares);
        deal(address(dusd), address(tranches), dusd.balanceOf(address(tranches)) + cost, true);
        vm.startPrank(address(tranches));
        dusd.approve(address(vault), cost);
        assets = vault.mint(shares, receiver);
        vm.stopPrank();
    }

    /// @dev Fund the vault the way the product does: a real user joining Ballast.
    function _joinBallast(address user, uint256 assets) internal {
        vm.startPrank(user);
        dusd.approve(address(tranches), assets);
        tranches.joinBallast(assets);
        vm.stopPrank();
    }
}
