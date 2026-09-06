// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DemoUSD} from "../../src/DemoUSD.sol";
import {MockWMON} from "../../src/mocks/MockWMON.sol";
import {MockRouter} from "../../src/mocks/MockRouter.sol";

contract MocksTest is Test {
    DemoUSD internal dusd;
    MockWMON internal wmon;
    MockRouter internal router;

    function setUp() public {
        dusd = new DemoUSD();
        wmon = new MockWMON();
        router = new MockRouter(address(dusd), address(wmon));
        wmon.setRouter(address(router));
        dusd.faucet();
    }

    function test_routerRoundTrip1to1() public {
        dusd.approve(address(router), 10e6);
        uint256 baseOut = router.swapExactQuoteForBase(10e6, 10e18, block.timestamp + 60);
        assertEq(baseOut, 10e18);
        assertEq(wmon.balanceOf(address(this)), 10e18);

        wmon.approve(address(router), baseOut);
        uint256 quoteOut = router.swapExactBaseForQuote(baseOut, 10e6, block.timestamp + 60);
        assertEq(quoteOut, 10e6);
    }

    function test_routerExpiredAndBadPath() public {
        dusd.approve(address(router), 1e6);
        vm.expectRevert(MockRouter.Expired.selector);
        router.swapExactQuoteForBase(1e6, 1, block.timestamp - 1);

        vm.expectRevert(MockRouter.InsufficientOutput.selector);
        router.swapExactQuoteForBase(1e6, type(uint256).max, block.timestamp + 1);
    }

    function test_wmonOnlyRouterMints() public {
        vm.expectRevert(MockWMON.NotRouter.selector);
        wmon.mint(address(this), 1);
        // re-set blocked
        vm.expectRevert(MockWMON.NotRouter.selector);
        wmon.setRouter(address(1));
    }

    function test_decimalsMismatchReverts() public {
        MockWMON bad = new MockWMON();
        // DemoUSD is 6dec; pass a 6dec token as "base" by using dusd — should revert
        vm.expectRevert();
        new MockRouter(address(dusd), address(dusd));
        bad.setRouter(address(this)); // allow constructing with wrong quote later
    }
}
