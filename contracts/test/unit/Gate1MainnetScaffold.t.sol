// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Fixture} from "../helpers/Fixture.sol";
import {ManualTwapOracle} from "../../src/oracles/ManualTwapOracle.sol";
import {RouterMidOracle} from "../../src/oracles/RouterMidOracle.sol";
import {Tranches} from "../../src/Tranches.sol";
import {EngineLite} from "../../src/EngineLite.sol";

contract Gate1MainnetScaffoldTest is Fixture {
    function setUp() public {
        _deploy();
        _faucet(owner, 2);
        vm.startPrank(owner);
        dusd.approve(address(venue), 200e6);
        venue.seed(200e6);
        vm.stopPrank();
    }

    function test_depositCapBlocksJoin() public {
        vm.prank(owner);
        tranches.setDepositCap(50e6);
        _faucet(alice, 5);
        _joinBallast(alice, 40e6);
        vm.startPrank(alice);
        dusd.approve(address(tranches), 20e6);
        vm.expectRevert(abi.encodeWithSelector(Tranches.DepositCapExceeded.selector, 60e6, 50e6));
        tranches.joinBallast(20e6);
        vm.stopPrank();
    }

    function test_depositCapZeroMeansUncapped() public {
        _faucet(alice, 5);
        _joinBallast(alice, 100e6);
        assertEq(tranches.balTvl(), 100e6);
    }

    function test_manualTwapOracleMarksSpot() public {
        ManualTwapOracle twap = new ManualTwapOracle(owner, 30 days, 18, 6);
        vm.prank(owner);
        engine.setSpotOracle(address(twap));

        _faucet(alice, 5);
        _joinBallast(alice, 100e6);
        // Push after faucet warps so maxStale is not tripped.
        vm.prank(owner);
        twap.pushPrice(2e6); // 1 WMON = 2 dUSD
        // totalAssets=200 (dead+live), deployable=180, half spot=90e18 WMON
        // mark = 90e18 * 2e6 / 1e18 = 180e6
        vm.prank(alice);
        engine.deployLiquidity(_minBaseOut());
        assertEq(engine.lastSpotValue(), 180e6);
    }

    function test_staleOracleFallsBackToRouter() public {
        ManualTwapOracle twap = new ManualTwapOracle(owner, 1 hours, 18, 6);
        vm.prank(owner);
        engine.setSpotOracle(address(twap)); // never pushed → stale

        _faucet(alice, 5);
        _joinBallast(alice, 100e6);
        vm.prank(alice);
        engine.deployLiquidity(_minBaseOut());
        assertEq(engine.lastSpotValue(), 90e6); // router 1:1 on 90e18 WMON
    }

    function test_netDeltaHaltLatchesAndUnwindClears() public {
        ManualTwapOracle twap = new ManualTwapOracle(owner, 1 hours, 18, 6);
        vm.prank(owner);
        twap.pushPrice(1e6); // start 1:1
        vm.prank(owner);
        engine.setSpotOracle(address(twap));
        vm.prank(owner);
        engine.setNetDeltaHaltBps(1);

        _faucet(alice, 5);
        _joinBallast(alice, 100e6);
        vm.prank(alice);
        engine.deployLiquidity(_minBaseOut());

        // Skew mark without inventing extra WMON (keeps MockRouter solvent on unwind).
        vm.prank(owner);
        twap.pushPrice(20e6);
        vm.prank(owner);
        venue.setFundingRateBps(0);
        vm.warp(block.timestamp + 1);
        vm.prank(alice);
        engine.crank();
        assertTrue(engine.deltaHalted());

        vm.expectRevert(EngineLite.DeltaHalted.selector);
        vm.prank(alice);
        engine.crank();

        vm.prank(bob);
        engine.unwind(_minQuoteOut());
        assertFalse(engine.deltaHalted());
    }

    function test_routerMidOracleName() public {
        RouterMidOracle mid = new RouterMidOracle(address(router));
        assertEq(mid.oracleName(), "RouterMidOracle");
        assertEq(mid.quoteBaseInQuote(1e18), router.quoteExactBaseForQuote(1e18));
    }
}
