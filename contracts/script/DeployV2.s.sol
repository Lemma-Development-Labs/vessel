// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {TrancheController} from "../src/core/TrancheController.sol";
import {PauseGuardian} from "../src/core/governance/PauseGuardian.sol";
import {IPauseGuardian} from "../src/core/interfaces/ICore.sol";
import {SimulatedEngine} from "../src/core/testnet/SimulatedEngine.sol";

/// @notice Deploy the v2 core to a TEST network (ADR-008). Governance is the Safe acting
///         through a TimelockController; the deployer keeps no role. Refuses Monad mainnet:
///         a mainnet release goes through the release manifest and gate evaluator (Session 8).
///
/// Env: DEPLOYER_PK, V2_SAFE, V2_OPERATOR, V2_ASSET, optional V2_GUARDIAN (default V2_SAFE),
///      V2_TIMELOCK_DELAY (seconds, default 300), V2_MANIFEST_OUT (default ../deployments/<chain>-v2.json)
contract DeployV2 is Script {
    struct Deployed {
        address timelock;
        address pauses;
        address controller;
        address custody;
        address escrow;
        address ballast;
        address engine;
    }

    function run() external returns (Deployed memory d) {
        if (block.chainid == 143) revert("DeployV2: mainnet requires the release process (Session 8)");
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address safe = vm.envAddress("V2_SAFE");
        address operator = vm.envAddress("V2_OPERATOR");
        address asset = vm.envAddress("V2_ASSET");
        address guardian = vm.envOr("V2_GUARDIAN", safe);
        uint256 delay = vm.envOr("V2_TIMELOCK_DELAY", uint256(300));
        require(safe.code.length > 0 || block.chainid == 31337, "V2_SAFE must be a contract (the Safe)");

        address[] memory safeOnly = new address[](1);
        safeOnly[0] = safe;

        vm.startBroadcast(pk);
        TimelockController tl = new TimelockController(delay, safeOnly, safeOnly, address(0));
        PauseGuardian pg = new PauseGuardian(guardian, address(tl));
        TrancheController c =
            new TrancheController(IERC20(asset), IPauseGuardian(address(pg)), address(tl), operator, safe, 1e12, 1);
        SimulatedEngine eng = new SimulatedEngine(IERC20(asset), address(c.custody()), address(tl));
        vm.stopBroadcast();

        d = Deployed({
            timelock: address(tl),
            pauses: address(pg),
            controller: address(c),
            custody: address(c.custody()),
            escrow: address(c.escrow()),
            ballast: address(c.ballast()),
            engine: address(eng)
        });
        _writeManifest(d, vm.addr(pk), safe, guardian, operator, asset, delay);
    }

    function _writeManifest(
        Deployed memory d,
        address deployer,
        address safe,
        address guardian,
        address operator,
        address asset,
        uint256 delay
    ) internal {
        string memory env = block.chainid == 10143 ? "testnet" : "local";
        string memory c = "contracts";
        vm.serializeAddress(c, "TimelockController", d.timelock);
        vm.serializeAddress(c, "PauseGuardian", d.pauses);
        vm.serializeAddress(c, "TrancheController", d.controller);
        vm.serializeAddress(c, "AssetCustody", d.custody);
        vm.serializeAddress(c, "ClaimEscrow", d.escrow);
        vm.serializeAddress(c, "BallastToken", d.ballast);
        vm.serializeAddress(c, "DemoUSD", asset);
        string memory contractsJson = vm.serializeAddress(c, "SimulatedEngine", d.engine);

        string memory r = "roles";
        vm.serializeAddress(r, "deployer", deployer);
        vm.serializeAddress(r, "governanceSafe", safe);
        vm.serializeAddress(r, "guardian", guardian);
        string memory rolesJson = vm.serializeAddress(r, "operator", operator);

        string memory m = "manifest";
        vm.serializeUint(m, "schemaVersion", 1);
        vm.serializeString(m, "environment", env);
        vm.serializeUint(m, "chainId", block.chainid);
        vm.serializeString(m, "venue", "sim");
        vm.serializeUint(m, "deployedBlock", block.number);
        vm.serializeUint(m, "timelockDelaySeconds", delay);
        vm.serializeString(m, "status", "SIMULATED engine; G01-G04 BLOCKED; not audited");
        vm.serializeString(m, "roles", rolesJson);
        string memory out = vm.serializeString(m, "contracts", contractsJson);

        string memory path = vm.envOr("V2_MANIFEST_OUT", string.concat("../deployments/", env, "-v2.json"));
        vm.writeJson(out, path);
        console2.log("manifest written to", path);
    }
}
