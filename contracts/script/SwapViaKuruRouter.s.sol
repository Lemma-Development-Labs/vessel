// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {KuruRouter} from "../src/venues/KuruRouter.sol";

/// @notice One real USDC→WMON market buy through a deployed KuruRouter.
/// @dev Requires ask liquidity on MON-USDC. Env:
///      DEPLOYER_PK, KURU_ROUTER, QUOTE_IN (default 1e6 = 1 USDC),
///      optional MIN_BASE_OUT (default = on-chain quote preview; reverts if 0).
///      Append the printed hash to docs/ADDRESSES.md as TX_KURU_SPOT.
contract SwapViaKuruRouter is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address routerAddr = vm.envAddress("KURU_ROUTER");
        uint256 quoteIn = vm.envOr("QUOTE_IN", uint256(1e6));
        KuruRouter router = KuruRouter(payable(routerAddr));
        IERC20 usdc = router.quoteToken();

        uint256 preview = router.quoteExactQuoteForBase(quoteIn);
        uint256 minOut = vm.envOr("MIN_BASE_OUT", preview);
        require(minOut > 0, "minOut=0: book empty or set MIN_BASE_OUT from L2");

        vm.startBroadcast(pk);
        usdc.approve(routerAddr, quoteIn);
        uint256 out = router.swapExactQuoteForBase(quoteIn, minOut, block.timestamp + 300);
        vm.stopBroadcast();

        console.log("baseOut", out);
        console.log("minOut", minOut);
        console.log("block", block.number);
        console.log("APPEND docs/ADDRESSES.md:");
        console.log("TX_KURU_SPOT  <txhash>  %s  <date>  USDC->MON via KuruRouter", block.number);
    }
}
