// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {Tranches} from "../../src/Tranches.sol";

/// @dev Read-only accounting checks against live testnet. Skips unless
///      ADDRESSES.json is a 10143 deployment with code at EngineLite.
contract ForkAccountingTest is Test {
    using stdJson for string;

    function test_forkVaultIdentityAndFloor() public {
        string memory rpc = vm.envOr("MONAD_TESTNET_RPC", string("https://testnet-rpc.monad.xyz"));
        try vm.createSelectFork(rpc) {
        // forked
        }
        catch {
            vm.skip(true);
            return;
        }
        if (block.chainid != 10143) {
            vm.skip(true);
            return;
        }

        string memory raw = vm.readFile("../ADDRESSES.json");
        uint256 chainId = raw.readUint(".chainId");
        if (chainId != 10143) {
            vm.skip(true);
            return;
        }
        address vaultAddr = raw.readAddress(".contracts.BlitzVault");
        address tranchesAddr = raw.readAddress(".contracts.Tranches");
        address dusdAddr = raw.readAddress(".contracts.DemoUSD");
        if (vaultAddr.code.length == 0 || tranchesAddr.code.length == 0) {
            vm.skip(true);
            return;
        }

        BlitzVault vault = BlitzVault(vaultAddr);
        Tranches tranches = Tranches(tranchesAddr);
        assertEq(vault.totalAssets(), IERC20(dusdAddr).balanceOf(vaultAddr) + vault.deployed());
        (uint256 h, uint256 b,,,,,, uint256 theta) = tranches.deckStats();
        if (h + b > 0) {
            assertGe(b * 10_000, 2_000 * (h + b));
            assertEq(theta, (b * 10_000) / (h + b));
        }
    }
}
