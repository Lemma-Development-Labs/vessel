// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {KuruRouter} from "../../src/venues/KuruRouter.sol";
import {IKuruOrderBook} from "../../src/interfaces/IKuruOrderBook.sol";
import {IWETH} from "../../src/interfaces/IWETH.sol";
import {Guardian} from "../../src/guards/Guardian.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {Tranches} from "../../src/Tranches.sol";
import {SimVenue} from "../../src/venues/SimVenue.sol";
import {EngineLite} from "../../src/EngineLite.sol";
import {DemoUSD} from "../../src/DemoUSD.sol";
import {MockWMON} from "../../src/mocks/MockWMON.sol";
import {MockRouter} from "../../src/mocks/MockRouter.sol";
import {MockKuruBook} from "../mocks/MockKuruBook.sol";

/// @dev Wrong-decimal ERC20 for constructor assert.
contract BadDecToken {
    uint8 public immutable decimals;
    string public name = "Bad";
    string public symbol = "BAD";

    constructor(uint8 d) {
        decimals = d;
    }
}

/// @notice Fork 10143 tests for KuruRouter. Live CLOB fills require ask liquidity;
///         when the official MON-USDC book is empty we exercise the adapter against
///         a MockKuruBook seeded with MON + quote on the fork (real WMON wrap path).
contract KuruRouterForkTest is Test {
    address internal constant KURU_USDC = 0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570;
    address internal constant CIRCLE_USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3;
    address internal constant WMON = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;
    address internal constant MON_USDC = 0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9;
    address internal constant MARGIN = 0xd029C2D98ff85D8F64799017fE00a59B1159CE02;

    uint32 internal constant PRICE_PREC = 1e8;
    uint96 internal constant SIZE_PREC = 1e10;

    /// @dev Foundry refuses `createSelectFork(monadRpc)` when the default EVM is
    ///      ethereum. Prefer `--fork-url` / `FOUNDRY_ETH_RPC_URL` / profile.testnet.
    ///      If already on 10143 (runner passed --fork-url), reuse that fork.
    function _fork() internal returns (bool ok) {
        if (block.chainid == 10143) return true;
        string memory rpc = vm.envOr("MONAD_TESTNET_RPC", string("https://testnet-rpc.monad.xyz"));
        try vm.createSelectFork(rpc) {
            ok = block.chainid == 10143;
        } catch {
            ok = false;
        }
    }

    function test_VaultAssetEqualsKuruQuoteToken() public {
        if (!_fork()) {
            vm.skip(true);
            return;
        }
        (,,,, address quoteAsset,,,,,,) = IKuruOrderBook(MON_USDC).getMarketParams();
        assertEq(quoteAsset, KURU_USDC, "book quote must be Kuru testnet USDC");

        Guardian g = new Guardian(address(this));
        BlitzVault vault = new BlitzVault(IERC20(KURU_USDC), address(g));
        assertEq(vault.asset(), quoteAsset);
        assertEq(vault.asset(), KURU_USDC);
        // Circle USDC has no Kuru book — must never be the vault asset for this path.
        assertTrue(vault.asset() != CIRCLE_USDC);
    }

    function testFork_RevertsOnDecimalsMismatch() public {
        MockKuruBook book = new MockKuruBook(address(1), PRICE_PREC, SIZE_PREC);
        BadDecToken badQ = new BadDecToken(18);
        BadDecToken okB = new BadDecToken(18);
        vm.expectRevert(abi.encodeWithSelector(KuruRouter.DecimalsMismatch.selector, uint8(18), uint8(18)));
        new KuruRouter(address(book), MARGIN, address(badQ), address(okB));
    }

    function testFork_SwapQuoteForBase_fillsAtOrBetterThanMinOut() public {
        if (!_fork()) {
            vm.skip(true);
            return;
        }
        (KuruRouter router,) = _deployAdapter();
        uint256 quoteIn = 100e6;
        deal(KURU_USDC, address(this), quoteIn);
        IERC20(KURU_USDC).approve(address(router), quoteIn);

        uint256 preview = router.quoteExactQuoteForBase(quoteIn);
        assertGt(preview, 0);
        uint256 out = router.swapExactQuoteForBase(quoteIn, preview, block.timestamp + 60);
        assertGe(out, preview);
        assertEq(IWETH(WMON).balanceOf(address(this)), out);
    }

    function testFork_SwapBaseForQuote_roundTrip_lossIsOnlyFeesAndSpread() public {
        if (!_fork()) {
            vm.skip(true);
            return;
        }
        (KuruRouter router, MockKuruBook book) = _deployAdapter();
        book.setTakerFeeBps(10);
        // Cast before multiply — PRICE_PREC is uint32; 1e8*1001 overflows uint32.
        book.setBestBidAsk((uint256(PRICE_PREC) * 999) / 1000, (uint256(PRICE_PREC) * 1001) / 1000);

        uint256 quoteIn = 1_000e6;
        deal(KURU_USDC, address(this), quoteIn);
        IERC20(KURU_USDC).approve(address(router), quoteIn);
        uint256 minBase = router.quoteExactQuoteForBase(quoteIn);
        uint256 baseOut = router.swapExactQuoteForBase(quoteIn, (minBase * 99) / 100, block.timestamp + 60);

        IWETH(WMON).approve(address(router), baseOut);
        uint256 minQuote = router.quoteExactBaseForQuote(baseOut);
        uint256 quoteOut = router.swapExactBaseForQuote(baseOut, (minQuote * 99) / 100, block.timestamp + 60);

        assertGe(quoteOut, (quoteIn * 9_900) / 10_000, "round-trip loss beyond fees/spread");
        assertLt(quoteOut, quoteIn, "must lose something to fees/spread");
    }

    function testFork_RevertsWhenMinOutUnmet() public {
        if (!_fork()) {
            vm.skip(true);
            return;
        }
        (KuruRouter router,) = _deployAdapter();
        uint256 quoteIn = 50e6;
        deal(KURU_USDC, address(this), quoteIn);
        IERC20(KURU_USDC).approve(address(router), quoteIn);
        uint256 preview = router.quoteExactQuoteForBase(quoteIn);
        vm.expectRevert();
        router.swapExactQuoteForBase(quoteIn, preview + 1, block.timestamp + 60);
    }

    function testFork_UnwindReachableAfterFullDeploy() public {
        if (!_fork()) {
            vm.skip(true);
            return;
        }
        (EngineLite engine, BlitzVault vault, KuruRouter router, address alice) = _wireEngine();
        uint256 deposit = 200e6;
        deal(KURU_USDC, alice, deposit);

        Tranches tranches = Tranches(vault.tranches());
        vm.startPrank(alice);
        IERC20(KURU_USDC).approve(address(tranches), deposit);
        tranches.joinBallast(deposit);
        vm.stopPrank();

        uint256 minBase = router.quoteExactQuoteForBase(vault.deployable() / 2);
        assertGt(minBase, 0);
        engine.deployLiquidity((minBase * 99) / 100);
        assertTrue(engine.shortId() != 0);
        assertGt(IWETH(WMON).balanceOf(address(engine)), 0);

        uint256 wmonBal = IWETH(WMON).balanceOf(address(engine));
        uint256 minQuote = router.quoteExactBaseForQuote(wmonBal);
        engine.unwind((minQuote * 99) / 100);
        assertEq(engine.shortId(), 0);
        assertEq(IWETH(WMON).balanceOf(address(engine)), 0);
        assertGt(IERC20(KURU_USDC).balanceOf(address(vault)), 0);
    }

    /// @dev ΔHull+ΔBallast+ΔReserve+fees == grossYield with an IRouter-wired engine
    ///      (MockRouter implements the same surface as KuruRouter). Proves the
    ///      interface swap did not break the conservation identity.
    function testFuzz_ConservationIdentity_withKuruRouter(int96 rawG, uint32 rawDt) public {
        DemoUSD dusd = new DemoUSD();
        MockWMON wmon = new MockWMON();
        // Prove KuruRouter constructs with 6/18 + native-base book shape.
        MockKuruBook book = new MockKuruBook(address(dusd), PRICE_PREC, SIZE_PREC);
        KuruRouter kuruShape = new KuruRouter(address(book), MARGIN, address(dusd), address(wmon));
        assertEq(address(kuruShape.quoteToken()), address(dusd));

        MockRouter mock = new MockRouter(address(dusd), address(wmon));
        wmon.setRouter(address(mock));
        Guardian guardian = new Guardian(address(this));
        BlitzVault vault = new BlitzVault(dusd, address(guardian));
        Tranches tranches = new Tranches(address(vault), address(guardian), address(this));
        SimVenue venue = new SimVenue(address(dusd), address(this));
        EngineLite engine = new EngineLite(address(guardian));
        vault.setEngine(address(engine));
        tranches.setEngine(address(engine));
        engine.wire(address(vault), address(tranches), address(venue), address(mock), address(wmon));
        dusd.faucet();
        dusd.approve(address(vault), 100e6);
        vault.seedDeadShares(100e6);
        vault.setTranches(address(tranches));

        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        _faucetMany(dusd, alice, 10);
        _faucetMany(dusd, bob, 10);
        vm.startPrank(bob);
        dusd.approve(address(tranches), 400e6);
        tranches.joinBallast(400e6);
        vm.stopPrank();
        vm.startPrank(alice);
        dusd.approve(address(tranches), 400e6);
        tranches.joinHull(400e6);
        vm.stopPrank();

        engine.deployLiquidity(mock.quoteExactQuoteForBase(vault.deployable() / 2));

        uint256 dt = bound(uint256(rawDt), 1, 30 days);
        vm.warp(block.timestamp + dt);

        uint256 tvl = tranches.hullTvl() + tranches.balTvl() + tranches.reserve();
        uint256 cap = tvl * 5_000 / 10_000;
        int256 maxLoss = int256(tranches.balTvl() + tranches.reserve());
        if (uint256(maxLoss) > cap) maxLoss = int256(cap);
        int256 hi = int256(uint256(50e6));
        if (uint256(hi) > cap) hi = int256(cap);
        int256 G = _boundInt(int256(rawG), maxLoss == 0 ? int256(0) : -maxLoss, hi);

        uint256 h0 = tranches.hullTvl();
        uint256 b0 = tranches.balTvl();
        uint256 r0 = tranches.reserve();
        uint256 t0 = tranches.treasuryAccrued();
        if (G < 0 && uint256(-G) > r0 + b0) {
            vm.expectRevert(Tranches.HullImpairment.selector);
            vm.prank(address(engine));
            tranches.settle(G);
            return;
        }
        vm.prank(address(engine));
        tranches.settle(G);
        int256 dH = int256(tranches.hullTvl()) - int256(h0);
        int256 dB = int256(tranches.balTvl()) - int256(b0);
        int256 dR = int256(tranches.reserve()) - int256(r0);
        int256 dT = int256(tranches.treasuryAccrued()) - int256(t0);
        assertEq(dH + dB + dR + dT, G, "conservation with IRouter stack");
        assertEq(vault.totalAssets(), dusd.balanceOf(address(vault)) + vault.deployed());
    }

    function _deployAdapter() internal returns (KuruRouter router, MockKuruBook book) {
        book = new MockKuruBook(KURU_USDC, PRICE_PREC, SIZE_PREC);
        vm.deal(address(book), 1_000_000 ether);
        deal(KURU_USDC, address(book), 1_000_000e6, true);
        router = new KuruRouter(address(book), MARGIN, KURU_USDC, WMON);
    }

    function _wireEngine()
        internal
        returns (EngineLite engine, BlitzVault vault, KuruRouter router, address alice)
    {
        alice = makeAddr("alice");
        MockKuruBook book = new MockKuruBook(KURU_USDC, PRICE_PREC, SIZE_PREC);
        vm.deal(address(book), 1_000_000 ether);
        deal(KURU_USDC, address(book), 1_000_000e6, true);
        router = new KuruRouter(address(book), MARGIN, KURU_USDC, WMON);

        Guardian guardian = new Guardian(address(this));
        vault = new BlitzVault(IERC20(KURU_USDC), address(guardian));
        Tranches tranches = new Tranches(address(vault), address(guardian), address(this));
        SimVenue venue = new SimVenue(KURU_USDC, address(this));
        deal(KURU_USDC, address(this), 100e6, true);
        IERC20(KURU_USDC).approve(address(venue), 100e6);
        venue.seed(100e6);

        engine = new EngineLite(address(guardian));
        vault.setEngine(address(engine));
        tranches.setEngine(address(engine));
        engine.wire(address(vault), address(tranches), address(venue), address(router), WMON);

        deal(KURU_USDC, address(this), 100e6, true);
        IERC20(KURU_USDC).approve(address(vault), 100e6);
        vault.seedDeadShares(100e6);
        vault.setTranches(address(tranches));
    }

    function _faucetMany(DemoUSD dusd, address user, uint256 times) internal {
        uint256 t = block.timestamp;
        for (uint256 i; i < times; i++) {
            t += 1 hours;
            vm.warp(t);
            vm.prank(user);
            dusd.faucet();
        }
    }

    function _boundInt(int256 x, int256 min, int256 max) internal pure returns (int256) {
        if (min > max) (min, max) = (max, min);
        uint256 range = uint256(max - min);
        if (range == 0) return min;
        uint256 shifted = uint256(x < 0 ? -x : x) % (range + 1);
        return min + int256(shifted);
    }
}
