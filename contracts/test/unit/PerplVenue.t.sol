// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PerplPositionReader} from "../../src/venues/PerplPositionReader.sol";
import {PerplVenue} from "../../src/venues/PerplVenue.sol";
import {SimVenue} from "../../src/venues/SimVenue.sol";
import {DemoUSD} from "../../src/DemoUSD.sol";
import {Guardian} from "../../src/guards/Guardian.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {Tranches} from "../../src/Tranches.sol";
import {MockPerplExchange} from "../mocks/MockPerplExchange.sol";

contract PerplVenueUnitTest is Test {
    uint256 internal constant MARKET = 64;
    uint8 internal constant SHORT = 1;

    MockPerplExchange internal exchange;
    PerplPositionReader internal reader;
    PerplVenue internal venue;
    address internal keeper = makeAddr("keeper");

    function setUp() public {
        exchange = new MockPerplExchange();
        // MON market: priceDecimals=5, lotDecimals=0 (verified live 2026-09-06)
        reader = new PerplPositionReader(address(exchange), MARKET, 5, 0);
        venue = new PerplVenue(address(reader), keeper, 100);
    }

    function test_accountIdReturnsZeroWhenAbsent() public view {
        (uint256 id, uint256 b) = reader.accountId(keeper);
        assertEq(id, 0);
        assertEq(b, block.number);
    }

    function test_positionAndNotionalFromExchange() public {
        uint256 acc = exchange.setAccount(keeper, 1_000e6);
        // lot=1000, price=250000 (=>$2.50 with 5dec), scale 10^(6-5)=10
        // notional = 1000 * 250000 * 10 = 2_500_000_000 = 2500e6
        exchange.setPosition(MARKET, acc, SHORT, 500e6, 250_000, 1000, -12e6);

        (int256 size, uint256 entry, uint256 margin, int256 funding, uint256 b) = reader.position(acc);
        assertEq(size, -1000);
        assertEq(entry, 250_000);
        assertEq(margin, 500e6);
        assertEq(funding, -12e6);
        assertEq(b, block.number);

        (int256 n,) = reader.notionalQuote(acc);
        assertEq(n, -int256(2_500e6));

        venue.targetShort(int256(2_500e6));
        (uint256 shortN,) = venue.currentShort();
        assertEq(shortN, 2_500e6);

        (int256 delta,) = venue.netDelta(2_500e6);
        assertEq(delta, 0);

        (int256 dev,) = venue.deviation(2_500e6);
        assertEq(dev, 0);
        venue.assertWithinBand(2_500e6);
    }

    function test_liquidationPriceRevertsFieldNotOnChain() public {
        vm.expectRevert(abi.encodeWithSelector(PerplPositionReader.FieldNotOnChain.selector, "liquidationPrice"));
        reader.liquidationPrice(1);
    }

    function test_netDeltaMatchesHandCompute() public {
        uint256 acc = exchange.setAccount(keeper, 1_000e6);
        exchange.setPosition(MARKET, acc, SHORT, 100e6, 200_000, 50, 0);
        // notional = 50 * 200000 * 10 = 100_000_000 = 100e6
        uint256 spot = 120e6;
        (int256 delta,) = venue.netDelta(spot);
        assertEq(delta, int256(spot) - int256(100e6));
    }

    function test_deviationBandBreachHalts() public {
        uint256 acc = exchange.setAccount(keeper, 1_000e6);
        exchange.setPosition(MARKET, acc, SHORT, 100e6, 200_000, 50, 0); // short 100e6
        // spot 200e6 ⇒ deviation = (200-100)/200 = 50% = 5000 bps > 100
        vm.expectRevert(abi.encodeWithSelector(PerplVenue.DeviationBreached.selector, int256(5000), uint256(100)));
        venue.assertWithinBand(200e6);
    }

    function test_openShortRecordsIntentOnly() public {
        uint256 id = venue.openShort(1_000e6);
        assertEq(id, 1);
        assertEq(venue.targetNotional(), 1_000e6);
        assertTrue(venue.targetOpen());
        // No exchange account ⇒ currentShort is 0 (intent ≠ truth)
        (uint256 shortN,) = venue.currentShort();
        assertEq(shortN, 0);
    }

    function test_closeShortAndSweepRevertOffChain() public {
        venue.openShort(1_000e6);
        vm.expectRevert(abi.encodeWithSelector(PerplVenue.OrdersOffChainOnly.selector, "closeShort"));
        venue.closeShort(1);
        vm.expectRevert(PerplVenue.FundingSweepOffChainOnly.selector);
        venue.sweepFunding(1);
    }

    function test_isSimulatedFalse() public view {
        assertFalse(venue.isSimulated());
        assertEq(venue.venueName(), "PerplVenue");
    }
}

/// @notice Same net-delta assertions against SimVenue vs PerplVenue (mock exchange).
contract VenueSwapIsOneContractTest is Test {
    function test_venueSwapIsOneContract() public {
        DemoUSD dusd = new DemoUSD();
        SimVenue sim = new SimVenue(address(dusd), address(this));
        dusd.faucet();
        dusd.approve(address(sim), 100e6);
        sim.seed(100e6);

        uint256 simId = sim.openShort(50e6);
        (uint256 simN,) = sim.position(simId);
        assertEq(simN, 50e6);
        assertTrue(sim.isSimulated());

        MockPerplExchange ex = new MockPerplExchange();
        PerplPositionReader r = new PerplPositionReader(address(ex), 64, 5, 0);
        address keeper = address(this);
        uint256 acc = ex.setAccount(keeper, 100e6);
        // notional 50e6: lot * price * 10 = 50e6 ⇒ lot=25, price=200_000
        ex.setPosition(64, acc, 1, 10e6, 200_000, 25, 0);
        PerplVenue p = new PerplVenue(address(r), keeper, 100);
        uint256 pId = p.openShort(50e6);
        (uint256 pN,) = p.position(pId);
        assertEq(pN, 50e6);
        assertFalse(p.isSimulated());

        (int256 dSim,) = sim.netDelta(50e6);
        (int256 dPerp,) = p.netDelta(50e6);
        assertEq(dSim, 0);
        assertEq(dPerp, 0);
        assertEq(dSim, dPerp);
    }
}

contract ConservationWithPerplVenueTest is Test {
    DemoUSD internal dusd;
    Guardian internal guardian;
    BlitzVault internal vault;
    Tranches internal tranches;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");

    function setUp() public {
        dusd = new DemoUSD();
        guardian = new Guardian(address(this));
        vault = new BlitzVault(dusd, address(guardian));
        tranches = new Tranches(address(vault), address(guardian), treasury);
        vault.setEngine(address(this));
        tranches.setEngine(address(this));
        dusd.faucet();
        dusd.approve(address(vault), 100e6);
        vault.seedDeadShares(100e6);
        vault.setTranches(address(tranches));
        _fill(alice, 10);
        _fill(bob, 10);
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();
    }

    function _fill(address user, uint256 times) internal {
        uint256 t = block.timestamp;
        for (uint256 i; i < times; i++) {
            t += 1 hours;
            vm.warp(t);
            vm.prank(user);
            dusd.faucet();
        }
    }

    /// @dev Conservation identity is a Tranches property; wiring PerplVenue must not
    ///      change settle accounting. Venue only records intent here.
    function testFuzz_conservationIdentity_withPerplVenue(int96 rawG, uint32 rawDt) public {
        MockPerplExchange ex = new MockPerplExchange();
        PerplPositionReader r = new PerplPositionReader(address(ex), 64, 5, 0);
        PerplVenue p = new PerplVenue(address(r), address(this), 100);
        p.openShort(1e6); // intent only — proves PerplVenue is selectable

        uint256 dt = bound(uint256(rawDt), 1, 365 days);
        vm.warp(block.timestamp + dt);

        uint256 h0 = tranches.hullTvl();
        uint256 b0 = tranches.balTvl();
        uint256 r0 = tranches.reserve();
        uint256 t0 = tranches.treasuryAccrued();
        uint256 tvl = h0 + b0 + r0;
        uint256 cap = (tvl * 5_000) / 10_000;

        int256 maxLoss = int256(b0 + r0);
        if (uint256(maxLoss) > cap) maxLoss = int256(cap);
        int256 hi = int256(uint256(50e6));
        if (uint256(hi) > cap) hi = int256(cap);
        int256 G = bound(int256(rawG), maxLoss == 0 ? int256(0) : -maxLoss, hi);

        if (G < 0 && uint256(-G) > b0 + r0) {
            vm.expectRevert(Tranches.HullImpairment.selector);
            tranches.settle(G);
            return;
        }

        tranches.settle(G);
        assertEq(
            int256(tranches.hullTvl()) - int256(h0) + int256(tranches.balTvl()) - int256(b0)
                + int256(tranches.reserve()) - int256(r0) + int256(tranches.treasuryAccrued()) - int256(t0),
            G,
            "conservation"
        );
        assertEq(p.venueName(), "PerplVenue");
    }
}
