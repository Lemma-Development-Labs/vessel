// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Decimals} from "../../src/lib/Decimals.sol";

contract DecimalsTest is Test {
    function test_dusdToWmonRoundTripDown() public pure {
        uint256 dusd = 1_000_000; // 1 dUSD
        uint256 wmon = Decimals.dusdToWmon(dusd);
        assertEq(wmon, 1e18);
        assertEq(Decimals.wmonToDusdDown(wmon), dusd);
    }

    function test_wmonToDusdDownFloorsDust() public pure {
        assertEq(Decimals.wmonToDusdDown(1e12 - 1), 0);
        assertEq(Decimals.wmonToDusdDown(1e12), 1);
    }

    function test_wmonToDusdUpRoundsLosses() public pure {
        assertEq(Decimals.wmonToDusdUp(1), 1);
        assertEq(Decimals.wmonToDusdUp(1e12), 1);
        assertEq(Decimals.wmonToDusdUp(1e12 + 1), 2);
    }
}
