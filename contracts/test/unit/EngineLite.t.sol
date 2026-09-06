// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "../helpers/Fixture.sol";
import {EngineLite} from "../../src/EngineLite.sol";
import {SimVenue} from "../../src/venues/SimVenue.sol";
import {PerplVenue} from "../../src/venues/PerplVenue.sol";
import {PerplPositionReader} from "../../src/venues/PerplPositionReader.sol";
import {MockPerplExchange} from "../mocks/MockPerplExchange.sol";

contract EngineLiteTest is Fixture {
    function setUp() public {
        _deploy();
        _faucet(alice, 6);
        _faucet(bob, 6);
        address seeder = makeAddr("venueSeeder");
        _faucet(seeder, 3);
        vm.startPrank(seeder);
        dusd.approve(address(venue), 300e6);
        venue.seed(300e6);
        vm.stopPrank();
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
    }

    function test_wireOnce() public {
        vm.prank(owner);
        vm.expectRevert(EngineLite.AlreadyWired.selector);
        engine.wire(address(vault), address(tranches), address(venue), address(router), address(wmon));
    }

    function test_notDeployerCannotWireFresh() public {
        EngineLite fresh = new EngineLite(address(guardian));
        vm.prank(alice);
        vm.expectRevert(EngineLite.NotDeployer.selector);
        fresh.wire(address(vault), address(tranches), address(venue), address(router), address(wmon));
    }

    function test_wireZeroAddressReverts() public {
        EngineLite fresh = new EngineLite(address(guardian));
        vm.expectRevert(EngineLite.ZeroAddress.selector);
        fresh.wire(address(0), address(tranches), address(venue), address(router), address(wmon));
    }

    function test_crankNotWiredReverts() public {
        EngineLite fresh = new EngineLite(address(guardian));
        vm.expectRevert(EngineLite.NotWired.selector);
        fresh.crank();
    }

    function test_alreadyDeployedReverts() public {
        engine.deployLiquidity();
        vm.expectRevert(EngineLite.AlreadyDeployed.selector);
        engine.deployLiquidity();
    }

    function test_crankWithoutPositionIsZeroGross() public {
        vm.warp(block.timestamp + 1);
        uint256 h0 = tranches.hullTvl();
        engine.crank();
        assertEq(tranches.hullTvl(), h0);
        assertEq(engine.shortId(), 0);
    }

    function test_negativeSpotPnlIsCapped() public {
        engine.deployLiquidity();
        uint256 bal = wmon.balanceOf(address(engine));
        vm.prank(address(router));
        wmon.burn(address(engine), bal / 2);
        vm.warp(block.timestamp + 1);
        uint256 hull0 = tranches.hullTvl();
        uint256 bal0 = tranches.balTvl();
        engine.crank();
        assertEq(tranches.hullTvl(), hull0, "hull unchanged on capped mark loss");
        assertLe(tranches.balTvl(), bal0);
    }

    function test_simVenueRateBound() public {
        vm.prank(owner);
        vm.expectRevert(SimVenue.ImplausibleRate.selector);
        venue.setFundingRateBps(10_001);
        vm.prank(owner);
        venue.setFundingRateBps(-2_400);
        assertEq(venue.fundingRateBps(), -2_400);
    }

    function test_unwindAfterDeployClearsBook() public {
        engine.deployLiquidity();
        assertGt(engine.shortId(), 0);
        engine.unwind();
        assertEq(engine.shortId(), 0);
        assertEq(wmon.balanceOf(address(engine)), 0);
        assertEq(vault.totalAssets(), dusd.balanceOf(address(vault)) + vault.deployed());
    }
}

contract PerplVenueTest is Fixture {
    function test_perplVenueIntentAndViews() public {
        MockPerplExchange ex = new MockPerplExchange();
        PerplPositionReader reader = new PerplPositionReader(address(ex), 64, 5, 0);
        PerplVenue p = new PerplVenue(address(reader), address(this), 100);
        uint256 id = p.openShort(1e6);
        assertEq(id, 1);
        assertEq(p.targetNotional(), 1e6);
        vm.expectRevert(abi.encodeWithSelector(PerplVenue.OrdersOffChainOnly.selector, "closeShort"));
        p.closeShort(id);
        vm.expectRevert(PerplVenue.FundingSweepOffChainOnly.selector);
        p.sweepFunding(id);
        assertEq(p.venueName(), "PerplVenue");
        assertFalse(p.isSimulated());
    }
}
