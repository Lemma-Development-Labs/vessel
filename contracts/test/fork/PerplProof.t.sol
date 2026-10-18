// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Exact Perpl Exchange surface used by the proof. Signatures are
///      PerplFoundation/dex-sdk `crates/sdk/abi/dex/Exchange.json`
///      (rc_v1.1.7-203-g0e5902dd); every selector was checked present in the
///      testnet implementation bytecode 0xbcbd3701…adbb on 2026-10-05.
interface IPerplExchangeProof {
    struct OrderDesc {
        uint256 orderDescId;
        uint256 perpId;
        uint8 orderType; // 0 OpenLong, 1 OpenShort, 2 CloseLong, 3 CloseShort
        uint256 orderId;
        uint256 pricePNS;
        uint256 lotLNS;
        uint256 expiryBlock;
        bool postOnly;
        bool fillOrKill;
        bool immediateOrCancel;
        uint256 maxMatches;
        uint256 leverageHdths;
        uint256 lastExecutionBlock;
        uint256 amountCNS;
        uint256 maxNegPnlCollatBPS;
    }

    struct OrderSignature {
        uint256 perpId;
        uint256 orderId;
    }

    struct PositionBitMap {
        uint256 bank1;
        uint256 bank2;
        uint256 bank3;
        uint256 bank4;
    }

    struct AccountInfo {
        uint256 accountId;
        uint256 balanceCNS;
        uint256 lockedBalanceCNS;
        uint8 frozen;
        address accountAddr;
        PositionBitMap positions;
    }

    struct PositionInfo {
        uint256 accountId;
        uint256 nextNodeId;
        uint256 prevNodeId;
        uint8 positionType; // 0 Long, 1 Short
        uint256 depositCNS;
        uint256 pricePNS;
        uint256 lotLNS;
        uint256 entryBlock;
        int256 pnlCNS;
        int256 deltaPnlCNS;
        int256 premiumPnlCNS;
    }

    function createAccount(uint256 amountCNS) external returns (uint256 accountId);
    function depositCollateral(uint256 amountCNS) external;
    function withdrawCollateral(uint256 amountCNS) external;
    function execOrder(OrderDesc calldata orderDesc) external returns (OrderSignature memory);
    function getAccountByAddr(address accountAddress) external view returns (AccountInfo memory);
    function getPosition(uint256 perpId, uint256 accountId)
        external
        view
        returns (PositionInfo memory positionInfo, uint256 markPricePNS, bool markPriceValid);
    function getExchangeInfo()
        external
        view
        returns (uint256, uint256, uint256, uint256 collateralDecimals, address collateralToken, address);
    function getMinAccountOpenCNS() external view returns (uint256);
}

/// @dev Stand-in for the future HedgedEngine: a contract that owns its Perpl
///      account outright. No EOA, API key or forwarding is involved (G01).
contract PerplAccountProbe {
    IPerplExchangeProof public immutable exchange;
    IERC20 public immutable collateral;
    uint256 public accountId;
    uint256 internal nextDescId = 1;

    constructor(IPerplExchangeProof exchange_, IERC20 collateral_) {
        exchange = exchange_;
        collateral = collateral_;
    }

    function open(uint256 amount) external {
        collateral.approve(address(exchange), amount);
        accountId = exchange.createAccount(amount);
    }

    function deposit(uint256 amount) external {
        collateral.approve(address(exchange), amount);
        exchange.depositCollateral(amount);
    }

    /// @param orderType 1 OpenShort, 3 CloseShort. Taker-only (IOC) at a limit price.
    function take(uint256 perpId, uint8 orderType, uint256 limitPNS, uint256 lots, uint256 leverageHdths) external {
        exchange.execOrder(
            IPerplExchangeProof.OrderDesc({
                orderDescId: nextDescId++,
                perpId: perpId,
                orderType: orderType,
                orderId: 0,
                pricePNS: limitPNS,
                lotLNS: lots,
                expiryBlock: 0,
                postOnly: false,
                fillOrKill: false,
                immediateOrCancel: true,
                maxMatches: 100,
                leverageHdths: leverageHdths,
                lastExecutionBlock: block.number + 5,
                amountCNS: 0,
                maxNegPnlCollatBPS: 1000
            })
        );
    }

    function withdraw(uint256 amount, address to) external {
        exchange.withdrawCollateral(amount);
        collateral.transfer(to, amount);
    }
}

/// @notice Proof on a fork of Monad testnet that a CONTRACT can own a Perpl
///         account and run the full short lifecycle: create → deposit → open
///         short → read position → close → withdraw. Opt-in (VENUE_FORK=1):
///         it needs a live RPC and must never run in CI.
contract PerplProofTest is Test {
    IPerplExchangeProof constant EXCHANGE = IPerplExchangeProof(0x1964C32f0bE608E7D29302AFF5E61268E72080cc);
    uint256 constant MON_PERP = 64; // testnet MON-PERP; mainnet is 10
    address constant AUSD_TESTNET = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;

    PerplAccountProbe probe;
    IERC20 ausd;

    function setUp() public {
        if (!vm.envOr("VENUE_FORK", false)) {
            vm.skip(true);
            return;
        }
        string memory rpc = vm.envOr("MONAD_TESTNET_RPC", string("https://testnet-rpc.monad.xyz"));
        vm.createSelectFork(rpc);
        (,,, uint256 dec, address token,) = EXCHANGE.getExchangeInfo();
        assertEq(token, AUSD_TESTNET, "Perpl testnet collateral changed");
        assertEq(dec, 6);
        ausd = IERC20(token);
        probe = new PerplAccountProbe(EXCHANGE, ausd);
        // AUSD keeps balances in non-standard storage, so `deal` cannot find the
        // slot. On the fork, take test AUSD from the exchange's own balance.
        vm.prank(address(EXCHANGE));
        ausd.transfer(address(probe), 1_000e6);
    }

    function test_contractOwnedShortLifecycle() public {
        uint256 minOpen = EXCHANGE.getMinAccountOpenCNS();
        console2.log("min account open (AUSD 6dp)", minOpen);

        // 1. The contract opens its own account.
        probe.open(500e6);
        IPerplExchangeProof.AccountInfo memory acct = EXCHANGE.getAccountByAddr(address(probe));
        assertEq(acct.accountAddr, address(probe), "account not owned by the contract");
        assertEq(acct.accountId, probe.accountId());
        assertEq(acct.balanceCNS, 500e6);
        console2.log("account id", acct.accountId);

        // 2. Top up.
        probe.deposit(100e6);
        assertEq(EXCHANGE.getAccountByAddr(address(probe)).balanceCNS, 600e6);

        // 3. Short 1,000 MON, crossing the book down to 2% under mark.
        (, uint256 mark, bool valid) = EXCHANGE.getPosition(MON_PERP, acct.accountId);
        assertTrue(valid, "mark invalid");
        console2.log("mark PNS (5dp)", mark);
        probe.take(MON_PERP, 1, (mark * 98) / 100, 1_000, 200);

        (IPerplExchangeProof.PositionInfo memory pos,,) = EXCHANGE.getPosition(MON_PERP, acct.accountId);
        console2.log("short lots", pos.lotLNS);
        console2.log("entry PNS", pos.pricePNS);
        console2.log("position deposit CNS", pos.depositCNS);
        assertEq(pos.positionType, 1, "not short");
        assertEq(pos.lotLNS, 1_000, "short not fully filled");

        // 4. Close it: buy back up to 2% over mark (reduce-only).
        probe.take(MON_PERP, 3, (mark * 102) / 100, 1_000, 200);
        (pos,,) = EXCHANGE.getPosition(MON_PERP, acct.accountId);
        assertEq(pos.lotLNS, 0, "short not closed");

        // 5. Withdraw everything that is free back to a fixed custody address.
        uint256 free = EXCHANGE.getAccountByAddr(address(probe)).balanceCNS;
        console2.log("free after round trip CNS", free);
        assertGt(free, 590e6, "round trip lost more than 10 AUSD");
        address custody = makeAddr("custody");
        probe.withdraw(free, custody);
        assertEq(ausd.balanceOf(custody), free);
        assertEq(EXCHANGE.getAccountByAddr(address(probe)).balanceCNS, 0);
    }
}
