// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DemoUSD} from "../../src/DemoUSD.sol";
import {MockWMON} from "../../src/mocks/MockWMON.sol";
import {MockRouter} from "../../src/mocks/MockRouter.sol";
import {Decimals} from "../../src/lib/Decimals.sol";

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
        address[] memory path = new address[](2);
        path[0] = address(dusd);
        path[1] = address(wmon);
        uint256[] memory out = router.swapExactTokensForTokens(10e6, 1, path, address(this), block.timestamp + 60);
        assertEq(out[1], Decimals.dusdToWmon(10e6));

        path[0] = address(wmon);
        path[1] = address(dusd);
        wmon.approve(address(router), out[1]);
        uint256[] memory back = router.swapExactTokensForTokens(out[1], 1, path, address(this), block.timestamp + 60);
        assertEq(back[1], 10e6);
    }

    function test_routerExpiredAndBadPath() public {
        address[] memory path = new address[](2);
        path[0] = address(dusd);
        path[1] = address(wmon);
        dusd.approve(address(router), 1e6);
        vm.expectRevert(MockRouter.Expired.selector);
        router.swapExactTokensForTokens(1e6, 1, path, address(this), block.timestamp - 1);

        address[] memory bad = new address[](1);
        bad[0] = address(dusd);
        vm.expectRevert(MockRouter.BadPath.selector);
        router.getAmountsOut(1e6, bad);
    }

    function test_wmonOnlyRouterMints() public {
        vm.expectRevert(MockWMON.NotRouter.selector);
        wmon.mint(address(this), 1);
        vm.expectRevert(MockWMON.NotRouter.selector);
        wmon.setRouter(address(1));
    }
}
