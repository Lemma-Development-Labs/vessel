// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SimVenue} from "../src/venues/SimVenue.sol";

/// @notice Flip SimVenue funding for the bad-day demo. Pass RATE_BPS (may be negative).
contract SetRate is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address venue = vm.envAddress("SIM_VENUE");
        int256 rate = vm.envInt("RATE_BPS");
        vm.startBroadcast(pk);
        SimVenue(venue).setFundingRateBps(rate);
        vm.stopBroadcast();
        console.logInt(rate);
    }
}
