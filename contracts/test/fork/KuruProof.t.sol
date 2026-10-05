// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Kuru Router surface (docs.kuru.io/contracts/Router).
interface IKuruRouterProof {
    function deployProxy(
        uint8 _type, // 0 NO_NATIVE, 1 NATIVE_IN_BASE, 2 NATIVE_IN_QUOTE
        address _baseAssetAddress,
        address _quoteAssetAddress,
        uint96 _sizePrecision,
        uint32 _pricePrecision,
        uint32 _tickSize,
        uint96 _minSize,
        uint96 _maxSize,
        uint256 _takerFeeBps,
        uint256 _makerFeeBps,
        uint96 _kuruAmmSpread
    ) external returns (address proxy);

    function anyToAnySwap(
        address[] calldata _marketAddresses,
        bool[] calldata _isBuy,
        bool[] calldata _nativeSend,
        address _debitToken,
        address _creditToken,
        uint256 _amount,
        uint256 _minAmountOut
    ) external payable returns (uint256 _amountOut);
}

interface IKuruVaultProof {
    function deposit(uint256 baseDeposit, uint256 quoteDeposit, uint256 minQuoteConsumed, address receiver)
        external
        payable
        returns (uint256);
}

interface IKuruBookProof {
    function bestBidAsk() external view returns (uint256, uint256);
    function addFlipBuyOrder(uint32 _price, uint32 _flippedPrice, uint96 _size, bool _provisionOrRevert) external;
    function addFlipSellOrder(uint32 _price, uint32 _flippedPrice, uint96 _size, bool _provisionOrRevert) external;
}

interface IKuruMarginProof {
    function deposit(address _user, address _token, uint256 _amount) external payable;
}

/// @dev Circle FiatToken admin surface, used only to mint test USDC on the fork.
interface IFiatTokenProof {
    function masterMinter() external view returns (address);
    function configureMinter(address minter, uint256 allowance) external returns (bool);
    function mint(address to, uint256 amount) external returns (bool);
}

/// @dev Stand-in for the future CollateralAdapter: converts USDC ⇄ AUSD through
///      two Kuru markets in ONE transaction under an aggregate output floor
///      (spec D02 / venue doc: "both legs atomic under an aggregate floor").
contract CollateralRouteProbe {
    IKuruRouterProof public immutable router;
    address public immutable usdc;
    address public immutable ausd;
    address public immutable monUsdc;
    address public immutable monAusd;

    constructor(IKuruRouterProof router_, address usdc_, address ausd_, address monUsdc_, address monAusd_) {
        router = router_;
        usdc = usdc_;
        ausd = ausd_;
        monUsdc = monUsdc_;
        monAusd = monAusd_;
    }

    receive() external payable {}

    function usdcToAusd(uint256 amountIn, uint256 minOut) external returns (uint256) {
        return _route(usdc, ausd, monUsdc, monAusd, amountIn, minOut);
    }

    function ausdToUsdc(uint256 amountIn, uint256 minOut) external returns (uint256) {
        return _route(ausd, usdc, monAusd, monUsdc, amountIn, minOut);
    }

    /// in → MON on `first` (buy MON), MON → out on `second` (sell native MON).
    function _route(address tin, address tout, address first, address second, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256 out)
    {
        address[] memory markets = new address[](2);
        markets[0] = first;
        markets[1] = second;
        bool[] memory isBuy = new bool[](2);
        isBuy[0] = true;
        isBuy[1] = false;
        bool[] memory nativeSend = new bool[](2);
        nativeSend[0] = false;
        nativeSend[1] = true;
        IERC20(tin).approve(address(router), amountIn);
        uint256 before = IERC20(tout).balanceOf(address(this));
        out = router.anyToAnySwap(markets, isBuy, nativeSend, tin, tout, amountIn, minOut);
        require(IERC20(tout).balanceOf(address(this)) - before == out, "reported != received");
        require(out >= minOut, "below floor");
    }
}

/// @notice Proof on a fork of Monad testnet that Vessel can (1) open its own
///         Kuru markets against official Circle USDC and Perpl's AUSD, (2) seed
///         them so both sides always quote, and (3) convert USDC ⇄ AUSD
///         atomically under an output floor. Opt-in (VENUE_FORK=1).
contract KuruProofTest is Test {
    IKuruRouterProof constant ROUTER = IKuruRouterProof(0x7EFbE105Ca7415dE98F96622173458ac1c054630);
    IKuruMarginProof constant MARGIN = IKuruMarginProof(0xd029C2D98ff85D8F64799017fE00a59B1159CE02);
    address constant USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3; // Circle, Monad testnet
    address constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC; // Perpl testnet collateral
    address constant PERPL = 0x1964C32f0bE608E7D29302AFF5E61268E72080cc;

    // MON ≈ $0.031 (Perpl testnet mark). 1 MON tick = 1e-6 USD at pricePrecision 1e8.
    uint32 constant PRICE_PRECISION = 1e8;
    uint96 constant SIZE_PRECISION = 1e10;
    uint32 constant TICK = 100;
    uint96 constant MIN_SIZE = 1e10; // 1 MON
    uint96 constant MAX_SIZE = 1e18; // 1e8 MON
    uint96 constant AMM_SPREAD = 100;

    // Seed per market (what we would ask partners for): a 2,000-quote flip bid at
    // 0.03099 and a 64,500-MON flip ask at 0.03101 (±3 bps around 0.031), plus a
    // small vault backstop of 10,000 MON + 310 quote that keeps both sides quoting.
    uint32 constant BID_PX = 3_099_000;
    uint32 constant ASK_PX = 3_101_000;
    uint96 constant FLIP_LOTS = 64_500 * 1e10;
    uint256 constant FLIP_QUOTE = 2_000e6;
    uint256 constant VAULT_MON = 10_000 ether;
    uint256 constant VAULT_QUOTE = 310e6;

    address seeder = makeAddr("seeder");
    address monUsdc;
    address monAusd;

    function setUp() public {
        if (!vm.envOr("VENUE_FORK", false)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(vm.envOr("MONAD_TESTNET_RPC", string("https://testnet-rpc.monad.xyz")));
        vm.deal(seeder, 1_000_000 ether);
        _mintUsdc(seeder, 100_000e6);
        vm.prank(PERPL);
        IERC20(AUSD).transfer(seeder, 100_000e6);

        (monUsdc,) = _openMarket(USDC);
        (monAusd,) = _openMarket(AUSD);
    }

    function test_marketsQuoteBothSides() public view {
        _assertTwoSided(monUsdc, "MON/USDC");
        _assertTwoSided(monAusd, "MON/AUSD");
    }

    function test_usdcToAusdAtomicRoundTrip() public {
        CollateralRouteProbe probe = new CollateralRouteProbe(ROUTER, USDC, AUSD, monUsdc, monAusd);
        _mintUsdc(address(probe), 100e6);

        // The spec's 20 bps aggregate conversion budget, no extra allowance.
        uint256 floor = 100e6 * (10_000 - 20) / 10_000;
        uint256 got = probe.usdcToAusd(100e6, floor);
        console2.log("100 USDC -> AUSD", got);
        assertEq(IERC20(USDC).balanceOf(address(probe)), 0);
        assertEq(IERC20(AUSD).balanceOf(address(probe)), got);

        uint256 back = probe.ausdToUsdc(got, got * (10_000 - 20) / 10_000);
        console2.log("-> USDC again", back);
        assertEq(IERC20(USDC).balanceOf(address(probe)), back);
        assertEq(address(probe).balance, 0, "MON left behind mid-route");
    }

    function test_floorRevertsWholeRoute() public {
        CollateralRouteProbe probe = new CollateralRouteProbe(ROUTER, USDC, AUSD, monUsdc, monAusd);
        _mintUsdc(address(probe), 100e6);
        vm.expectRevert();
        probe.usdcToAusd(100e6, 100e6 + 1); // can never receive more than it paid
        assertEq(IERC20(USDC).balanceOf(address(probe)), 100e6, "partial leg survived a revert");
    }

    // ── helpers ──────────────────────────────────────────────────────────

    function _openMarket(address quote) internal returns (address market, address vault) {
        vm.recordLogs();
        vm.prank(seeder);
        market = ROUTER.deployProxy(
            1, address(0), quote, SIZE_PRECISION, PRICE_PRECISION, TICK, MIN_SIZE, MAX_SIZE, 0, 0, AMM_SPREAD
        );
        vault = _vaultFromLogs(market);
        vm.startPrank(seeder);
        IERC20(quote).approve(vault, type(uint256).max);
        IKuruVaultProof(vault).deposit{value: VAULT_MON}(VAULT_MON, VAULT_QUOTE, 0, seeder);
        // Flip orders draw on the seeder's Kuru margin balance.
        IERC20(quote).approve(address(MARGIN), FLIP_QUOTE);
        MARGIN.deposit(seeder, quote, FLIP_QUOTE);
        MARGIN.deposit{value: 64_500 ether}(seeder, address(0), 64_500 ether);
        IKuruBookProof(market).addFlipBuyOrder(BID_PX, ASK_PX, uint96(FLIP_QUOTE * 1e10 * 1e8 / BID_PX / 1e6), true);
        IKuruBookProof(market).addFlipSellOrder(ASK_PX, BID_PX, FLIP_LOTS, true);
        vm.stopPrank();
        console2.log("market", market);
        console2.log("vault ", vault);
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

    function _assertTwoSided(address market, string memory name) internal view {
        (uint256 bid, uint256 ask) = IKuruBookProof(market).bestBidAsk();
        console2.log(name);
        console2.log("  bestBid", bid);
        console2.log("  bestAsk", ask);
        assertGt(bid, 0, "no bid");
        assertLt(bid, type(uint256).max, "no bid (sentinel)");
        assertGt(ask, bid, "crossed or empty ask");
    }

    function _mintUsdc(address to, uint256 amount) internal {
        address mm = IFiatTokenProof(USDC).masterMinter();
        vm.prank(mm);
        IFiatTokenProof(USDC).configureMinter(address(this), amount);
        IFiatTokenProof(USDC).mint(to, amount);
    }
}
