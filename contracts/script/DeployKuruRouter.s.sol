// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {KuruRouter} from "../src/venues/KuruRouter.sol";

/// @notice Deploys KuruRouter only (does not rewire the live EngineLite).
/// @dev Env (all required for a real broadcast):
///      DEPLOYER_PK, and optionally:
///      KURU_ORDER_BOOK / KURU_MARGIN / KURU_USDC / WMON (defaults = official 10143).
///      After deploy: verify via agents.devnads.com/v1/verify (scaffold skill).
contract DeployKuruRouter is Script {
    address internal constant DEFAULT_BOOK = 0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9;
    address internal constant DEFAULT_MARGIN = 0xd029C2D98ff85D8F64799017fE00a59B1159CE02;
    address internal constant DEFAULT_USDC = 0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570;
    address internal constant DEFAULT_WMON = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address book = vm.envOr("KURU_ORDER_BOOK", DEFAULT_BOOK);
        address margin = vm.envOr("KURU_MARGIN", DEFAULT_MARGIN);
        address usdc = vm.envOr("KURU_USDC", DEFAULT_USDC);
        address wmon = vm.envOr("WMON", DEFAULT_WMON);

        vm.startBroadcast(pk);
        KuruRouter router = new KuruRouter(book, margin, usdc, wmon);
        vm.stopBroadcast();

        console.log("KuruRouter", address(router));
        console.log("orderBook", address(router.orderBook()));
        console.log("quoteToken", address(router.quoteToken()));
        console.log("baseToken", address(router.baseToken()));
        console.log("block", block.number);
    }
}
