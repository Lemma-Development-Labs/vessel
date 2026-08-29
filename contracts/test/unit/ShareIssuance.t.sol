// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "../helpers/Fixture.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev A contract caller, to prove the gate is not EOA-only.
contract Depositoor {
    function tryDeposit(BlitzVault v, uint256 assets) external returns (uint256) {
        return v.deposit(assets, address(this));
    }

    function tryMint(BlitzVault v, uint256 shares) external returns (uint256) {
        return v.mint(shares, address(this));
    }
}

/// @dev vBLITZ issuance is closed to everyone but Tranches. This suite walks every
///      public ERC-4626 minting entry point from every plausible caller.
contract ShareIssuanceTest is Fixture {
    Depositoor internal outsider;

    function setUp() public {
        _deploy();
        outsider = new Depositoor();
    }

    function _callers() internal view returns (address[] memory a) {
        a = new address[](8);
        a[0] = alice; // plain EOA
        a[1] = owner; // the deployer
        a[2] = address(guardian); // the pause authority
        a[3] = address(engine); // the engine, which may move vault funds
        a[4] = treasury;
        a[5] = address(outsider); // a contract
        a[6] = vault.DEAD(); // the dead-share holder
        a[7] = address(vault); // the vault itself
    }

    /// @dev (a) Every public 4626 mint path, every caller, must revert NotTranches.
    function test_everyCallerIsLockedOutOfDepositAndMint() public {
        address[] memory callers = _callers();
        for (uint256 i; i < callers.length; i++) {
            address c = callers[i];
            uint256 sharesBefore = vault.balanceOf(c); // DEAD already holds the seed
            deal(address(dusd), c, 1_000e6, true);
            vm.startPrank(c);
            dusd.approve(address(vault), type(uint256).max);

            vm.expectRevert(BlitzVault.NotTranches.selector);
            vault.deposit(100e6, c);
            vm.expectRevert(BlitzVault.NotTranches.selector);
            vault.deposit(1, c);
            vm.expectRevert(BlitzVault.NotTranches.selector);
            vault.deposit(0, c);
            vm.expectRevert(BlitzVault.NotTranches.selector);
            vault.mint(1e12, c);
            vm.expectRevert(BlitzVault.NotTranches.selector);
            vault.mint(1, c);
            vm.expectRevert(BlitzVault.NotTranches.selector);
            vault.mint(0, c);

            // Receiver never matters — the gate is on msg.sender.
            vm.expectRevert(BlitzVault.NotTranches.selector);
            vault.deposit(100e6, address(tranches));
            vm.expectRevert(BlitzVault.NotTranches.selector);
            vault.mint(1e12, address(tranches));
            vm.stopPrank();

            assertEq(vault.balanceOf(c), sharesBefore, "no caller may gain vBLITZ");
        }
        assertEq(vault.totalSupply(), vault.balanceOf(vault.DEAD()), "only dead shares exist");
    }

    /// @dev A contract calling through its own frame is equally locked out.
    function test_contractCallerLockedOut() public {
        deal(address(dusd), address(outsider), 1_000e6, true);
        vm.prank(address(outsider));
        dusd.approve(address(vault), type(uint256).max);

        vm.expectRevert(BlitzVault.NotTranches.selector);
        outsider.tryDeposit(vault, 100e6);
        vm.expectRevert(BlitzVault.NotTranches.selector);
        outsider.tryMint(vault, 1e12);
    }

    /// @dev Tranches itself must still be able to mint, or the protocol is bricked.
    function test_tranchesCanStillMint() public {
        uint256 before = vault.balanceOf(address(tranches));
        _faucet(alice, 2);
        _joinBallast(alice, 100e6);
        assertGt(vault.balanceOf(address(tranches)), before, "Tranches still mints");
    }

    /// @dev Previews stay public — integrators quote against them.
    function test_previewsRemainOpen() public {
        vm.startPrank(alice);
        assertGt(vault.previewDeposit(100e6), 0);
        assertGt(vault.previewMint(1e12), 0);
        assertGt(vault.previewWithdraw(100e6), 0);
        assertGt(vault.previewRedeem(1e12), 0);
        assertEq(vault.maxDeposit(alice), type(uint256).max);
        assertEq(vault.maxMint(alice), type(uint256).max);
        assertEq(vault.convertToShares(100e6), vault.previewDeposit(100e6));
        vm.stopPrank();
    }

    /// @dev Withdraw/redeem stay open: only shareholders can call them, and after this
    ///      change the only shareholders are Tranches and DEAD.
    function test_withdrawRedeemStayOpenButOutsidersHoldNothing() public {
        vm.startPrank(alice);
        vm.expectRevert(); // ERC4626ExceededMaxWithdraw — no shares, not an access error
        vault.withdraw(1, alice, alice);
        vm.expectRevert();
        vault.redeem(1, alice, alice);
        vm.stopPrank();
    }
}

/// @dev (c) The dead-share seed is a one-shot, deployer-only bootstrap, and it must
///      happen before Tranches can be wired.
contract SeedDeadSharesTest is Fixture {
    BlitzVault internal fresh;

    function setUp() public {
        _deploy();
        fresh = new BlitzVault(dusd, address(guardian)); // deployer == address(this)
        deal(address(dusd), address(this), 10_000e6, true);
        dusd.approve(address(fresh), type(uint256).max);
    }

    function test_onlyDeployerCanSeed() public {
        deal(address(dusd), alice, 1_000e6, true);
        vm.startPrank(alice);
        dusd.approve(address(fresh), type(uint256).max);
        vm.expectRevert(BlitzVault.NotDeployer.selector);
        fresh.seedDeadShares(100e6);
        vm.stopPrank();

        vm.prank(owner);
        vm.expectRevert(BlitzVault.NotDeployer.selector);
        fresh.seedDeadShares(100e6);

        assertFalse(fresh.deadSharesSeeded());
    }

    function test_seedOnlyOnce() public {
        uint256 shares = fresh.seedDeadShares(100e6);
        assertEq(shares, 100e6 * 10 ** fresh.DECIMALS_OFFSET());
        assertEq(fresh.balanceOf(fresh.DEAD()), shares);
        assertTrue(fresh.deadSharesSeeded());

        vm.expectRevert(BlitzVault.DeadSharesAlreadySeeded.selector);
        fresh.seedDeadShares(100e6);
        vm.expectRevert(BlitzVault.DeadSharesAlreadySeeded.selector);
        fresh.seedDeadShares(1);
    }

    function test_seedRejectsZero() public {
        vm.expectRevert(BlitzVault.ZeroAmount.selector);
        fresh.seedDeadShares(0);
        assertFalse(fresh.deadSharesSeeded());
    }

    function test_seedMustPrecedeSetTranches() public {
        vm.expectRevert(BlitzVault.DeadSharesNotSeeded.selector);
        fresh.setTranches(address(tranches));

        fresh.seedDeadShares(100e6);
        fresh.setTranches(address(tranches));
        assertEq(fresh.tranches(), address(tranches));
    }

    function test_setTranchesOnlyOnceOnlyDeployerNonZero() public {
        fresh.seedDeadShares(100e6);

        vm.prank(alice);
        vm.expectRevert(BlitzVault.NotDeployer.selector);
        fresh.setTranches(address(tranches));

        vm.expectRevert(BlitzVault.ZeroAddress.selector);
        fresh.setTranches(address(0));

        fresh.setTranches(address(tranches));
        vm.expectRevert(BlitzVault.TranchesAlreadySet.selector);
        fresh.setTranches(address(1));
        assertEq(fresh.tranches(), address(tranches));
    }

    /// @dev Before wiring, nobody at all can mint — including the deployer.
    function test_nobodyCanMintBeforeTranchesIsWired() public {
        assertEq(fresh.tranches(), address(0));
        vm.expectRevert(BlitzVault.NotTranches.selector);
        fresh.deposit(100e6, address(this));
        vm.expectRevert(BlitzVault.NotTranches.selector);
        fresh.mint(1e12, address(this));

        // The seed is the one sanctioned exception, and it is exhausted after one use.
        fresh.seedDeadShares(100e6);
        assertEq(fresh.totalSupply(), fresh.balanceOf(fresh.DEAD()));
    }
}
