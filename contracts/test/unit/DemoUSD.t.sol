// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "../helpers/Fixture.sol";
import {DemoUSD} from "../../src/DemoUSD.sol";

contract DemoUSDTest is Fixture {
    function setUp() public {
        _deploy();
    }

    function test_faucetMints100() public {
        vm.prank(alice);
        dusd.faucet();
        assertEq(dusd.balanceOf(alice), 100e6);
    }

    function test_faucetCooldown() public {
        vm.prank(alice);
        dusd.faucet();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DemoUSD.FaucetCooldown.selector, 1 hours));
        dusd.faucet();
        vm.warp(block.timestamp + 1 hours);
        vm.prank(alice);
        dusd.faucet();
        assertEq(dusd.balanceOf(alice), 200e6);
    }

    function test_faucetLifetimeCap() public {
        _faucet(alice, 10);
        assertEq(dusd.balanceOf(alice), 1_000e6);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(alice);
        vm.expectRevert(DemoUSD.FaucetCap.selector);
        dusd.faucet();
    }

    function test_noPrivilegedMint() public {
        // DemoUSD has no mint() — only faucet. This compile-time absence is the test.
        assertEq(dusd.totalSupply(), 0);
    }
}
