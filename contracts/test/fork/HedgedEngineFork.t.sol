// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TrancheController} from "../../src/core/TrancheController.sol";
import {AssetCustody} from "../../src/core/AssetCustody.sol";
import {PauseGuardian} from "../../src/core/governance/PauseGuardian.sol";
import {IPauseGuardian, IStrategyEngine} from "../../src/core/interfaces/ICore.sol";
import {IKuruOrderBook, IKuruRouter, IPerplExchange} from "../../src/core/interfaces/IVenues.sol";
import {HedgedEngine} from "../../src/core/engine/HedgedEngine.sol";
import {PerplMarkValuation} from "../../src/core/testnet/PerplMarkValuation.sol";
import {IFiatTokenProof, IKuruBookProof, IKuruMarginProof, IKuruRouterProof, IKuruVaultProof} from "./KuruProof.t.sol";

/// @notice End to end on a fork of Monad testnet: the real v2 core on Circle USDC, HedgedEngine on
///         the real Perpl exchange and Vessel-opened Kuru markets. A Ballast deposit is admitted,
///         deployed, converted to margin, hedged in paired slices, settled, unwound and recalled.
///         Opt-in (VENUE_FORK=1): needs a live RPC and must never run in CI.
contract HedgedEngineForkTest is Test {
    TrancheController.Tranche constant BALLAST = TrancheController.Tranche.BALLAST;
    IPerplExchange constant PERPL = IPerplExchange(0x1964C32f0bE608E7D29302AFF5E61268E72080cc);
    uint256 constant PERP = 64;
    IKuruRouterProof constant ROUTER = IKuruRouterProof(0x7EFbE105Ca7415dE98F96622173458ac1c054630);
    IKuruMarginProof constant MARGIN = IKuruMarginProof(0xd029C2D98ff85D8F64799017fE00a59B1159CE02);
    IERC20 constant USDC = IERC20(0x534b2f3A21130d7a60830c2Df862319e593943A3);
    IERC20 constant AUSD = IERC20(0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC);

    address gov = makeAddr("gov");
    address op = makeAddr("keeper");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address seeder = makeAddr("seeder");

    TrancheController c;
    AssetCustody custody;
    HedgedEngine engine;
    uint32 mid; // Kuru price units (1e8) at the Perpl mark

    function setUp() public {
        if (!vm.envOr("VENUE_FORK", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envOr("MONAD_TESTNET_RPC", string("https://testnet-rpc.monad.xyz")));
        IPerplExchange.PerpetualInfoV2 memory p = PERPL.getPerpetualInfoV2(PERP);
        // Price freshness is checked against block time; start the fork just after the mark.
        if (block.timestamp > p.markTimestamp + 30) vm.warp(p.markTimestamp + 1);
        mid = uint32(p.markPNS * 1e3); // 5 dp → 8 dp

        vm.deal(seeder, 1_000_000 ether);
        _mintUsdc(seeder, 100_000e6);
        vm.prank(address(PERPL));
        AUSD.transfer(seeder, 100_000e6);
        address monUsdc = _openMarket(address(USDC));
        address monAusd = _openMarket(address(AUSD));

        PauseGuardian pg = new PauseGuardian(gov, gov);
        c = new TrancheController(USDC, IPauseGuardian(address(pg)), gov, op, treasury, 1e12, 1);
        custody = c.custody();
        PerplMarkValuation val = new PerplMarkValuation(PERPL, PERP);
        engine = new HedgedEngine(
            HedgedEngine.Config({
                usdc: USDC,
                ausd: AUSD,
                custody: address(custody),
                operator: op,
                governance: gov,
                guardian: IPauseGuardian(address(pg)),
                valuation: val,
                perpl: PERPL,
                perpId: PERP,
                leverageHdths: 100,
                kuruRouter: IKuruRouter(address(ROUTER)),
                monUsdc: IKuruOrderBook(monUsdc),
                monAusd: IKuruOrderBook(monAusd)
            })
        );
        vm.startPrank(gov);
        c.setEngine(IStrategyEngine(address(engine)));
        c.setStageCap(25_000e6);
        c.setAllowance(alice, 5_000e6);
        vm.stopPrank();
    }

    function test_depositHedgeSettleUnwind() public {
        // 1. Alice's Ballast request is admitted; 90% of the book goes to the engine.
        _mintUsdc(alice, 2_000e6);
        vm.startPrank(alice);
        USDC.approve(address(custody), type(uint256).max);
        c.requestDeposit(BALLAST, 0, 2_000e6, alice, 0, block.timestamp + 1 days);
        vm.stopPrank();
        vm.startPrank(op);
        c.processDepositBatch(10);
        c.deployToEngine(1_800e6);

        // 2. Margin: 600 USDC → AUSD atomically, then into the engine's own Perpl account.
        engine.convertToMargin(600e6, _floorAusd(600e6));
        engine.depositMargin(engine.ausdCash());
        console2.log("perpl account", engine.perplAccountId());
        assertGt(engine.perplAccountId(), 0);

        // 3. Three paired slices: buy spot on Kuru, short the same MON on Perpl.
        for (uint256 i; i < 3; i++) {
            uint256 slice = engine.sliceCap() * 95 / 100;
            engine.buySpot(slice, _floorMon(slice));
            uint256 lots = (engine.monQty() / 1e18) - engine.shortLots();
            engine.openShort(lots, _perpFloor());
        }
        vm.stopPrank();
        console2.log("spot MON (wei)", engine.monQty());
        console2.log("short lots", engine.shortLots());
        assertApproxEqAbs(engine.monQty() / 1e18, engine.shortLots(), 1, "hedge not matched");

        // 4. Settlement reads the engine through its valuation, within the 60 s window.
        (uint256 v,) = engine.value();
        console2.log("engine value (USDC 6dp)", v);
        assertApproxEqRel(v, 1_800e6, 0.005e18, "value drifted > 0.5% on entry");
        c.settle();
        assertApproxEqRel(c.activeAssets(), 2_000e6, 0.005e18);

        // 5. Unwind in slices, then pull everything back to custody.
        vm.startPrank(op);
        while (engine.shortLots() > 0) {
            uint256 lots = engine.shortLots();
            uint256 maxLots = engine.sliceCap() * 95 / 100 * 1e30 / _px() / 1e18;
            if (lots > maxLots) lots = maxLots;
            engine.closeShort(lots, _perpCeiling());
            uint256 mon = engine.monQty() - engine.shortLots() * 1e18;
            engine.sellSpot(mon, _floorUsdc(mon));
        }
        if (engine.monQty() > 0) engine.sellSpot(engine.monQty(), _floorUsdc(engine.monQty()));
        uint256 free = PERPL.getAccountByAddr(address(engine)).balanceCNS;
        engine.withdrawMargin(free);
        engine.convertToCash(engine.ausdCash(), _floorUsdcFromAusd(engine.ausdCash()));
        uint256 back = engine.usdcCash();
        c.recallFromEngine(back);
        vm.stopPrank();

        console2.log("recalled USDC", back);
        assertLt(engine.monQty(), 1e8, "more than Kuru's size step left");
        assertEq(engine.ausdCash(), 0);
        assertEq(engine.usdcCash(), 0);
        assertApproxEqRel(back, 1_800e6, 0.005e18, "round trip cost > 0.5%");
        (uint256 v2,) = engine.value();
        assertLt(v2, 1e6, "value left in the engine");
    }

    function test_guardianPauseStopsNewRiskOnly() public {
        _mintUsdc(alice, 2_000e6);
        vm.startPrank(alice);
        USDC.approve(address(custody), type(uint256).max);
        c.requestDeposit(BALLAST, 0, 2_000e6, alice, 0, block.timestamp + 1 days);
        vm.stopPrank();
        vm.startPrank(op);
        c.processDepositBatch(10);
        c.deployToEngine(1_800e6);
        engine.convertToMargin(600e6, _floorAusd(600e6));
        engine.depositMargin(engine.ausdCash());
        uint256 slice = engine.sliceCap() * 95 / 100;
        engine.buySpot(slice, _floorMon(slice));
        vm.stopPrank();

        PauseGuardian pg = PauseGuardian(address(engine.guardian()));
        vm.prank(gov);
        pg.pause(2);

        uint256 monFloor = _floorMon(slice);
        uint256 perpFloor = _perpFloor();
        uint256 usdcFloor = _floorUsdc(engine.monQty());
        vm.startPrank(op);
        vm.expectRevert(HedgedEngine.RiskPaused.selector);
        engine.buySpot(slice, monFloor);
        vm.expectRevert(HedgedEngine.RiskPaused.selector);
        engine.openShort(10, perpFloor);
        // Reducing spot still works while paused.
        engine.sellSpot(engine.monQty(), usdcFloor);
        vm.stopPrank();
        assertLt(engine.monQty(), 1e8, "more than Kuru's size step left");
    }

    // ── floors computed exactly as the engine requires ───────────────────

    function _px() internal view returns (uint256 px) {
        (px,,) = engine.valuation().prices();
    }

    function _floorMon(uint256 usdcIn) internal view returns (uint256) {
        return (usdcIn * 1e30 / _px()) * (10_000 - 30) / 10_000;
    }

    function _floorUsdc(uint256 mon) internal view returns (uint256) {
        uint256 sp = engine.spotSizePrecision();
        uint256 exact = (mon * sp / 1e18) * 1e18 / sp;
        return (exact * _px() / 1e30) * (10_000 - 30) / 10_000;
    }

    function _floorAusd(uint256 usdcIn) internal pure returns (uint256) {
        return usdcIn * (10_000 - 20) / 10_000;
    }

    function _floorUsdcFromAusd(uint256 ausdIn) internal pure returns (uint256) {
        return ausdIn * (10_000 - 20) / 10_000;
    }

    function _perpFloor() internal view returns (uint256) {
        return (_px() * engine.perpPriceScale() / 1e18) * (10_000 - 30) / 10_000;
    }

    function _perpCeiling() internal view returns (uint256) {
        return (_px() * engine.perpPriceScale() / 1e18) * (10_000 + 30) / 10_000;
    }

    // ── Vessel-opened Kuru market at the Perpl mark (as in KuruProof) ────

    function _openMarket(address quote) internal returns (address market) {
        vm.recordLogs();
        vm.prank(seeder);
        market = ROUTER.deployProxy(1, address(0), quote, 1e10, 1e8, 100, 1e10, 1e18, 0, 0, 100);
        address vault = _vaultFromLogs(market);
        uint32 bid = mid - 1_000;
        uint32 ask = mid + 1_000;
        vm.startPrank(seeder);
        IERC20(quote).approve(vault, type(uint256).max);
        IKuruVaultProof(vault).deposit{value: 10_000 ether}(10_000 ether, uint256(mid) * 10_000 / 100, 0, seeder);
        IERC20(quote).approve(address(MARGIN), 5_000e6);
        MARGIN.deposit(seeder, quote, 5_000e6);
        MARGIN.deposit{value: 150_000 ether}(seeder, address(0), 150_000 ether);
        IKuruBookProof(market).addFlipBuyOrder(bid, ask, uint96(uint256(5_000e6) * 1e10 * 1e8 / bid / 1e6), true);
        IKuruBookProof(market).addFlipSellOrder(ask, bid, 150_000 * 1e10, true);
        vm.stopPrank();
    }

    function _vaultFromLogs(address market) internal view returns (address) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256(
            "MarketRegistered(address,address,address,address,uint32,uint96,uint32,uint96,uint96,uint256,uint256,uint96)"
        );
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == topic) {
                (,, address m, address v) = abi.decode(logs[i].data, (address, address, address, address));
                if (m == market) return v;
            }
        }
        revert("MarketRegistered not found");
    }

    function _mintUsdc(address to, uint256 amount) internal {
        address mm = IFiatTokenProof(address(USDC)).masterMinter();
        vm.prank(mm);
        IFiatTokenProof(address(USDC)).configureMinter(address(this), amount);
        IFiatTokenProof(address(USDC)).mint(to, amount);
    }
}
