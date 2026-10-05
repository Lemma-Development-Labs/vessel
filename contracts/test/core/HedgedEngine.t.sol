// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TrancheController} from "../../src/core/TrancheController.sol";
import {AssetCustody} from "../../src/core/AssetCustody.sol";
import {PauseGuardian} from "../../src/core/governance/PauseGuardian.sol";
import {IPauseGuardian, IStrategyEngine} from "../../src/core/interfaces/ICore.sol";
import {IKuruOrderBook, IKuruRouter, IPerplExchange} from "../../src/core/interfaces/IVenues.sol";
import {HedgedEngine} from "../../src/core/engine/HedgedEngine.sol";
import {PerplMarkValuation} from "../../src/core/testnet/PerplMarkValuation.sol";
import {TestUSDC} from "../fixtures/CoreFixtures.sol";
import {MockKuruBook, MockKuruRouter, MockPerpl, MockValuation} from "../fixtures/VenueMocks.sol";

contract HedgedEngineTest is Test {
    TrancheController.Tranche constant BALLAST = TrancheController.Tranche.BALLAST;
    uint256 constant PERP = 64;

    address gov = makeAddr("gov");
    address op = makeAddr("keeper");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address mallory = makeAddr("mallory");

    TestUSDC usdc;
    TestUSDC ausd;
    PauseGuardian pg;
    TrancheController c;
    AssetCustody custody;
    MockValuation val;
    MockPerpl perpl;
    MockKuruBook monUsdc;
    MockKuruBook monAusd;
    MockKuruRouter router;
    HedgedEngine engine;

    function setUp() public {
        vm.warp(1_790_000_000);
        usdc = new TestUSDC();
        ausd = new TestUSDC();
        pg = new PauseGuardian(gov, gov);
        c = new TrancheController(usdc, IPauseGuardian(address(pg)), gov, op, treasury, 1e12, 1);
        custody = c.custody();
        val = new MockValuation();
        perpl = new MockPerpl(ausd, PERP);
        monUsdc = new MockKuruBook(usdc);
        monAusd = new MockKuruBook(ausd);
        router = new MockKuruRouter();
        // Venue liquidity.
        vm.deal(address(monUsdc), 10_000_000 ether);
        vm.deal(address(monAusd), 10_000_000 ether);
        usdc.mint(address(monUsdc), 1_000_000e6);
        ausd.mint(address(monAusd), 1_000_000e6);
        engine = new HedgedEngine(_config());
        vm.startPrank(gov);
        c.setEngine(IStrategyEngine(address(engine)));
        c.setStageCap(25_000e6);
        c.setAllowance(alice, 25_000e6);
        vm.stopPrank();
    }

    function _config() internal view returns (HedgedEngine.Config memory) {
        return HedgedEngine.Config({
            usdc: usdc,
            ausd: ausd,
            custody: address(custody),
            operator: op,
            governance: gov,
            guardian: IPauseGuardian(address(pg)),
            valuation: val,
            perpl: IPerplExchange(address(perpl)),
            perpId: PERP,
            leverageHdths: 100,
            kuruRouter: IKuruRouter(address(router)),
            monUsdc: IKuruOrderBook(address(monUsdc)),
            monAusd: IKuruOrderBook(address(monAusd))
        });
    }

    /// @dev Ballast of `assets` admitted, 90% deployed to the engine.
    function _fund(uint256 assets) internal {
        usdc.mint(alice, assets);
        vm.startPrank(alice);
        usdc.approve(address(custody), assets);
        c.requestDeposit(BALLAST, 0, assets, alice, 0, block.timestamp + 1 days);
        vm.stopPrank();
        vm.startPrank(op);
        c.processDepositBatch(10);
        c.deployToEngine(assets * 9 / 10);
        vm.stopPrank();
    }

    /// @dev Margin account opened with `usdcIn` converted to AUSD.
    function _margin(uint256 usdcIn) internal {
        vm.startPrank(op);
        engine.convertToMargin(usdcIn, _floorAusd(usdcIn));
        engine.depositMargin(engine.ausdCash());
        vm.stopPrank();
    }

    function _floorMon(uint256 usdcIn) internal view returns (uint256) {
        return (usdcIn * 1e30 / val.px()) * 9_970 / 10_000;
    }

    function _floorUsdc(uint256 mon) internal view returns (uint256) {
        uint256 exact = (mon * 1e10 / 1e18) * 1e18 / 1e10;
        return (exact * val.px() / 1e30) * 9_970 / 10_000;
    }

    function _floorAusd(uint256 usdcIn) internal view returns (uint256) {
        return (usdcIn * 1e18 / val.fx()) * 9_980 / 10_000;
    }

    function _perpFloor() internal view returns (uint256) {
        return (val.px() * 1e5 / 1e18) * 9_970 / 10_000;
    }

    function _perpCeiling() internal view returns (uint256) {
        return (val.px() * 1e5 / 1e18) * 10_030 / 10_000;
    }

    /// @dev One paired slice: spot at 95% of the cap, then the matching whole-MON short.
    function _pairedSlice() internal {
        vm.startPrank(op);
        uint256 slice = engine.sliceCap() * 95 / 100;
        engine.buySpot(slice, _floorMon(slice));
        engine.openShort(engine.monQty() / 1e18 - engine.shortLots(), _perpFloor());
        vm.stopPrank();
    }

    // ================================================================== construction
    function test_constructorRejectsWrongCollateral() public {
        HedgedEngine.Config memory cfg = _config();
        cfg.ausd = usdc; // Perpl collateral is ausd
        vm.expectRevert(HedgedEngine.BadConfig.selector);
        new HedgedEngine(cfg);
    }

    function test_constructorRejectsMarketWithWrongQuote() public {
        HedgedEngine.Config memory cfg = _config();
        cfg.monUsdc = IKuruOrderBook(address(monAusd));
        vm.expectRevert(HedgedEngine.BadConfig.selector);
        new HedgedEngine(cfg);
    }

    function test_constructorBoundsLeverage() public {
        HedgedEngine.Config memory cfg = _config();
        cfg.leverageHdths = 99;
        vm.expectRevert(HedgedEngine.BadConfig.selector);
        new HedgedEngine(cfg);
        cfg.leverageHdths = 301;
        vm.expectRevert(HedgedEngine.BadConfig.selector);
        new HedgedEngine(cfg);
    }

    function test_testnetValuationRefusesMainnet() public {
        vm.chainId(143);
        vm.expectRevert(PerplMarkValuation.Mainnet.selector);
        new PerplMarkValuation(IPerplExchange(address(perpl)), PERP);
    }

    function test_testnetValuationReadsPerplMark() public {
        PerplMarkValuation v = new PerplMarkValuation(IPerplExchange(address(perpl)), PERP);
        (uint256 px, uint256 fx, uint256 at) = v.prices();
        assertEq(px, 0.031e18);
        assertEq(fx, 1e18);
        assertEq(at, block.timestamp);
        assertFalse(v.isIndependent());
    }

    // ================================================================== custody boundary
    function test_creditAndReleaseOnlyCustody() public {
        vm.expectRevert(HedgedEngine.NotCustody.selector);
        engine.credit(1);
        vm.expectRevert(HedgedEngine.NotCustody.selector);
        engine.release(1);
    }

    function test_creditNeedsTokensPresent() public {
        vm.prank(address(custody));
        vm.expectRevert(HedgedEngine.Insufficient.selector);
        engine.credit(1);
    }

    function test_releasePaysOnlyCashToCustody() public {
        _fund(1_000e6);
        assertEq(engine.usdcCash(), 900e6);
        vm.prank(op);
        c.recallFromEngine(400e6);
        assertEq(engine.usdcCash(), 500e6);
        assertEq(custody.activeIdle(), 500e6);
        vm.prank(op);
        vm.expectRevert(HedgedEngine.Insufficient.selector);
        c.recallFromEngine(501e6);
    }

    function test_donationsAreQuarantinedNotValued() public {
        _fund(1_000e6);
        usdc.mint(address(engine), 77e6);
        ausd.mint(address(engine), 5e6);
        vm.deal(address(engine), 3 ether);
        (uint256 v,) = engine.value();
        assertEq(v, 900e6);
        (uint256 qu, uint256 qa, uint256 qm) = engine.quarantined();
        assertEq(qu, 77e6);
        assertEq(qa, 5e6);
        assertEq(qm, 3 ether);
    }

    // ================================================================== valuation
    function test_cashOnlyValueIsCurrentBlock() public {
        _fund(1_000e6);
        val.setStale(true);
        (uint256 v, uint256 at) = engine.value();
        assertEq(v, 900e6);
        assertEq(at, block.timestamp);
    }

    function test_pricedValueCarriesPriceTimeAndHaltsSettlementWhenStale() public {
        _fund(1_000e6);
        _margin(300e6);
        val.setStale(true);
        (, uint256 at) = engine.value();
        assertLt(at, block.timestamp - 60);
        vm.expectRevert(TrancheController.StaleValuation.selector);
        c.settle();
    }

    function test_hedgedValueIsNeutralToMonPrice() public {
        _fund(10_000e6);
        _margin(3_000e6);
        for (uint256 i; i < 5; i++) {
            _pairedSlice();
        }
        (uint256 before,) = engine.value();
        // MON +20%: spot gains, short loses the same.
        val.set(0.0372e18, 1e18);
        perpl.setMark(3_720);
        (uint256 up,) = engine.value();
        assertApproxEqAbs(up, before, 2e6, "not delta neutral");
        c.settle();
    }

    function test_perplEquityIncludesPnlAndClampsAtZero() public {
        _fund(1_000e6);
        _margin(300e6);
        _pairedSlice();
        uint256 eq = engine.perplEquity();
        perpl.setMark(3_200); // short loses
        assertLt(engine.perplEquity(), eq);
        perpl.setMark(1_000_000); // far beyond the margin
        assertEq(engine.perplEquity(), 0);
    }

    // ================================================================== trading bounds
    function test_buySpotRespectsSliceCap() public {
        _fund(1_000e6);
        uint256 cap = engine.sliceCap();
        assertEq(cap, 900e6 * 50 / 10_000);
        uint256 floor = _floorMon(cap + 1);
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(HedgedEngine.SliceTooLarge.selector, cap + 1, cap));
        engine.buySpot(cap + 1, floor);
    }

    function test_sliceCapNeverAbove100Usdc() public {
        _fund(25_000e6);
        assertEq(engine.sliceCap(), 100e6);
    }

    function test_keeperCannotLoosenTheSpotFloor() public {
        _fund(1_000e6);
        uint256 slice = engine.sliceCap();
        uint256 floor = _floorMon(slice);
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(HedgedEngine.FloorTooLoose.selector, floor - 1, floor));
        engine.buySpot(slice, floor - 1);
    }

    function test_spotFillBeyondSlippageReverts() public {
        _fund(1_000e6);
        monUsdc.set(3_100_000, 40); // ask 40 bps over the valuation price
        uint256 slice = engine.sliceCap();
        uint256 floor = _floorMon(slice);
        vm.prank(op);
        vm.expectRevert("SlippageExceeded");
        engine.buySpot(slice, floor);
        assertEq(engine.monQty(), 0);
        assertEq(engine.usdcCash(), 900e6);
    }

    function test_unhedgedGapLimitedToOneSlice() public {
        _fund(1_000e6);
        _margin(300e6);
        vm.startPrank(op);
        uint256 slice = engine.sliceCap() * 95 / 100;
        engine.buySpot(slice, _floorMon(slice));
        slice = engine.sliceCap() * 95 / 100;
        uint256 floor = _floorMon(slice);
        vm.expectPartialRevert(HedgedEngine.HedgeGap.selector);
        engine.buySpot(slice, floor);
        // Shorting narrows the gap and is always allowed.
        engine.openShort(engine.monQty() / 1e18, _perpFloor());
        vm.stopPrank();
    }

    function test_shortWithoutSpotLimitedToOneSlice() public {
        _fund(1_000e6);
        _margin(300e6);
        uint256 lots = engine.sliceCap() * 95 / 100 * 1e30 / val.px() / 1e18;
        uint256 floor = _perpFloor();
        vm.startPrank(op);
        engine.openShort(lots, floor);
        vm.expectPartialRevert(HedgedEngine.HedgeGap.selector);
        engine.openShort(lots, floor);
        vm.stopPrank();
    }

    function test_perpPriceBand() public {
        _fund(1_000e6);
        _margin(300e6);
        uint256 floor = _perpFloor();
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(HedgedEngine.FloorTooLoose.selector, floor - 1, floor));
        engine.openShort(10, floor - 1);
        uint256 ceiling = _perpCeiling();
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(HedgedEngine.FloorTooLoose.selector, ceiling + 1, ceiling));
        engine.closeShort(10, ceiling + 1);
    }

    function test_shortUsesConfiguredLeverage() public {
        _fund(1_000e6);
        _margin(300e6);
        _pairedSlice();
        assertEq(perpl.lastLeverage(), 100);
    }

    function test_stalePricesStopTrading() public {
        _fund(1_000e6);
        val.setStale(true);
        vm.prank(op);
        vm.expectRevert(HedgedEngine.StalePrice.selector);
        engine.buySpot(1e6, 0);
        vm.prank(op);
        vm.expectRevert(HedgedEngine.StalePrice.selector);
        engine.convertToMargin(100e6, 0);
    }

    // ================================================================== conversion
    function test_conversionRoundTripWithinFloor() public {
        _fund(1_000e6);
        vm.startPrank(op);
        engine.convertToMargin(300e6, _floorAusd(300e6));
        uint256 a = engine.ausdCash();
        assertGt(a, 300e6 * 9_980 / 10_000);
        engine.convertToCash(a, a * 9_980 / 10_000);
        vm.stopPrank();
        assertEq(engine.ausdCash(), 0);
        assertGt(engine.usdcCash(), 900e6 - 300e6 * 20 / 10_000);
    }

    function test_conversionFloorCannotBeLoosened() public {
        _fund(1_000e6);
        uint256 floor = _floorAusd(300e6);
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(HedgedEngine.FloorTooLoose.selector, floor - 1, floor));
        engine.convertToMargin(300e6, floor - 1);
    }

    function test_conversionBeyondFloorRevertsWholeRoute() public {
        _fund(1_000e6);
        monAusd.set(3_100_000, 30); // second leg 30 bps worse
        uint256 floor = _floorAusd(300e6);
        vm.prank(op);
        vm.expectRevert("SlippageExceeded");
        engine.convertToMargin(300e6, floor);
        assertEq(engine.usdcCash(), 900e6);
        assertEq(engine.ausdCash(), 0);
    }

    // ================================================================== margin
    function test_marginAccountOwnedByEngine() public {
        _fund(1_000e6);
        _margin(300e6);
        IPerplExchange.AccountInfo memory a = IPerplExchange(address(perpl)).getAccountByAddr(address(engine));
        assertEq(a.accountAddr, address(engine));
        assertEq(a.accountId, engine.perplAccountId());
        assertEq(engine.ausdCash(), 0);
    }

    function test_withdrawMarginReturnsToEngine() public {
        _fund(1_000e6);
        _margin(300e6);
        uint256 free = IPerplExchange(address(perpl)).getAccountByAddr(address(engine)).balanceCNS;
        vm.prank(op);
        engine.withdrawMargin(free);
        assertEq(engine.ausdCash(), free);
        assertEq(ausd.balanceOf(address(engine)), free);
    }

    // ================================================================== roles and pause
    function test_strangersCannotTrade() public {
        _fund(1_000e6);
        vm.startPrank(mallory);
        vm.expectRevert(HedgedEngine.NotOperator.selector);
        engine.buySpot(1e6, 0);
        vm.expectRevert(HedgedEngine.NotOperator.selector);
        engine.openShort(1, 0);
        vm.expectRevert(HedgedEngine.NotAllowed.selector);
        engine.sellSpot(0, 0);
        vm.expectRevert(HedgedEngine.NotAllowed.selector);
        engine.closeShort(1, 0);
        vm.expectRevert(HedgedEngine.NotAllowed.selector);
        engine.withdrawMargin(1);
        vm.expectRevert(HedgedEngine.NotAllowed.selector);
        engine.convertToCash(1, 0);
        vm.stopPrank();
    }

    function test_governanceCanUnwindWithoutTheKeeper() public {
        _fund(1_000e6);
        _margin(300e6);
        _pairedSlice();
        vm.startPrank(gov);
        engine.closeShort(engine.shortLots(), _perpCeiling());
        engine.sellSpot(engine.monQty(), _floorUsdc(engine.monQty()));
        vm.stopPrank();
        assertEq(engine.shortLots(), 0);
        assertLt(engine.monQty(), 1e8, "more than Kuru's size step left"); // 1e8 wei = 1 / sizePrecision
    }

    function test_pauseStopsNewRiskButNotReductionsOrTopUps() public {
        _fund(1_000e6);
        _margin(300e6);
        _pairedSlice();
        vm.prank(gov);
        pg.pause(2); // RISK_INCREASE
        uint256 monFloor = _floorMon(1e6);
        uint256 perpFloor = _perpFloor();
        vm.startPrank(op);
        vm.expectRevert(HedgedEngine.RiskPaused.selector);
        engine.buySpot(1e6, monFloor);
        vm.expectRevert(HedgedEngine.RiskPaused.selector);
        engine.openShort(1, perpFloor);
        engine.convertToMargin(50e6, _floorAusd(50e6));
        engine.depositMargin(engine.ausdCash());
        engine.closeShort(engine.shortLots(), _perpCeiling());
        engine.sellSpot(engine.monQty(), _floorUsdc(engine.monQty()));
        vm.stopPrank();
        assertEq(engine.shortLots(), 0);
    }

    // ================================================================== full cycle
    function test_fullCycleReturnsCapitalToCustody() public {
        _fund(10_000e6);
        _margin(3_000e6);
        for (uint256 i; i < 4; i++) {
            _pairedSlice();
        }
        c.settle();
        vm.startPrank(op);
        while (engine.shortLots() > 0) {
            uint256 lots = engine.shortLots();
            uint256 maxLots = engine.sliceCap() * 95 / 100 * 1e30 / val.px() / 1e18;
            if (lots > maxLots) lots = maxLots;
            engine.closeShort(lots, _perpCeiling());
            uint256 mon = engine.monQty() - engine.shortLots() * 1e18;
            engine.sellSpot(mon, _floorUsdc(mon));
        }
        engine.withdrawMargin(IPerplExchange(address(perpl)).getAccountByAddr(address(engine)).balanceCNS);
        engine.convertToCash(engine.ausdCash(), engine.ausdCash() * 9_980 / 10_000);
        uint256 cash = engine.usdcCash();
        c.recallFromEngine(cash);
        vm.stopPrank();
        assertLt(engine.monQty(), 1e8, "more than Kuru's size step left");
        assertEq(engine.ausdCash(), 0);
        assertApproxEqRel(custody.activeIdle(), 10_000e6, 0.001e18, "round trip > 10 bps");
        c.settle();
    }
}
