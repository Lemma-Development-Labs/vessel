// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {TrancheController} from "../src/core/TrancheController.sol";
import {PauseGuardian} from "../src/core/governance/PauseGuardian.sol";
import {IPauseGuardian} from "../src/core/interfaces/ICore.sol";
import {IStrategyEngine} from "../src/core/interfaces/ICore.sol";
import {IKuruOrderBook, IKuruRouter, IPerplExchange} from "../src/core/interfaces/IVenues.sol";
import {HedgedEngine} from "../src/core/engine/HedgedEngine.sol";
import {PerplMarkValuation} from "../src/core/testnet/PerplMarkValuation.sol";
import {SimulatedEngine} from "../src/core/testnet/SimulatedEngine.sol";

/// @notice Deploy the v2 core to a TEST network (ADR-008). Governance is the Safe acting
///         through a TimelockController; the deployer keeps no role. Refuses Monad mainnet:
///         a mainnet release goes through the release manifest and gate evaluator (Session 8).
///
/// Env: DEPLOYER_PK, V2_SAFE, V2_OPERATOR, V2_ASSET, optional V2_GUARDIAN (default V2_SAFE),
///      V2_TIMELOCK_DELAY (seconds, default 300), V2_MANIFEST_OUT (default ../deployments/<chain>-v2.json)
///      V2_ENGINE = "simulated" (default: SimulatedEngine over DemoUSD) or "hedged" (ADR-009:
///      HedgedEngine over Circle USDC, Perpl and Vessel's Kuru markets, priced by the Perpl
///      mark). Hedged also needs V2_AUSD, V2_PERPL, V2_PERP_ID, V2_KURU_ROUTER, V2_KURU_MON_USDC,
///      V2_KURU_MON_AUSD and optional V2_LEVERAGE_HDTHS (default 100 = 1×).
contract DeployV2 is Script {
    struct Deployed {
        address timelock;
        address pauses;
        address controller;
        address custody;
        address escrow;
        address ballast;
        address engine;
        address valuation;
        bool hedged;
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
        bool hedged = keccak256(bytes(vm.envOr("V2_ENGINE", string("simulated")))) == keccak256("hedged");
        address valuation;
        address eng;
        if (hedged) {
            (eng, valuation) = _hedged(IERC20(asset), address(c.custody()), operator, address(tl), address(pg));
        } else {
            eng = address(new SimulatedEngine(IERC20(asset), address(c.custody()), address(tl)));
        }
        vm.stopBroadcast();

        d = Deployed({
            timelock: address(tl),
            pauses: address(pg),
            controller: address(c),
            custody: address(c.custody()),
            escrow: address(c.escrow()),
            ballast: address(c.ballast()),
            engine: eng,
            valuation: valuation,
            hedged: hedged
        });
        _writeManifest(d, vm.addr(pk), safe, guardian, operator, asset, delay);
    }

    /// @dev Inside the broadcast. The engine checks the venues itself (collateral, market quotes).
    function _hedged(IERC20 usdc, address custody, address operator, address timelock, address pauses)
        internal
        returns (address engine, address valuation)
    {
        IPerplExchange perpl = IPerplExchange(vm.envAddress("V2_PERPL"));
        uint256 perpId = vm.envUint("V2_PERP_ID");
        valuation = address(new PerplMarkValuation(perpl, perpId));
        engine = address(
            new HedgedEngine(
                HedgedEngine.Config({
                    usdc: usdc,
                    ausd: IERC20(vm.envAddress("V2_AUSD")),
                    custody: custody,
                    operator: operator,
                    governance: timelock,
                    guardian: IPauseGuardian(pauses),
                    valuation: PerplMarkValuation(valuation),
                    perpl: perpl,
                    perpId: perpId,
                    leverageHdths: vm.envOr("V2_LEVERAGE_HDTHS", uint256(100)),
                    kuruRouter: IKuruRouter(vm.envAddress("V2_KURU_ROUTER")),
                    monUsdc: IKuruOrderBook(vm.envAddress("V2_KURU_MON_USDC")),
                    monAusd: IKuruOrderBook(vm.envAddress("V2_KURU_MON_AUSD"))
                })
            )
        );
        IStrategyEngine(engine).value(); // fails the run now if the engine cannot value itself
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
        string memory contractsJson;
        if (d.hedged) {
            vm.serializeAddress(c, "USDC", asset);
            vm.serializeAddress(c, "PerplMarkValuation", d.valuation);
            contractsJson = vm.serializeAddress(c, "HedgedEngine", d.engine);
        } else {
            vm.serializeAddress(c, "DemoUSD", asset);
            contractsJson = vm.serializeAddress(c, "SimulatedEngine", d.engine);
        }

        string memory r = "roles";
        vm.serializeAddress(r, "deployer", deployer);
        vm.serializeAddress(r, "governanceSafe", safe);
        vm.serializeAddress(r, "guardian", guardian);
        string memory rolesJson = vm.serializeAddress(r, "operator", operator);

        string memory m = "manifest";
        vm.serializeUint(m, "schemaVersion", 1);
        vm.serializeString(m, "environment", env);
        vm.serializeUint(m, "chainId", block.chainid);
        vm.serializeUint(m, "deployedBlock", block.number);
        vm.serializeUint(m, "timelockDelaySeconds", delay);
        if (d.hedged) {
            string memory v = "venues";
            vm.serializeAddress(v, "perpl", vm.envAddress("V2_PERPL"));
            vm.serializeUint(v, "perpId", vm.envUint("V2_PERP_ID"));
            vm.serializeAddress(v, "ausd", vm.envAddress("V2_AUSD"));
            vm.serializeAddress(v, "kuruRouter", vm.envAddress("V2_KURU_ROUTER"));
            vm.serializeAddress(v, "kuruMonUsdc", vm.envAddress("V2_KURU_MON_USDC"));
            string memory venuesJson = vm.serializeAddress(v, "kuruMonAusd", vm.envAddress("V2_KURU_MON_AUSD"));
            vm.serializeString(m, "venues", venuesJson);
            vm.serializeString(m, "venue", "perpl+kuru");
            vm.serializeString(
                m,
                "status",
                "HEDGED engine on Perpl + Vessel-opened Kuru markets; Perpl-mark valuation (not independent, G03); not audited"
            );
        } else {
            vm.serializeString(m, "venue", "sim");
            vm.serializeString(m, "status", "SIMULATED engine; G01-G04 BLOCKED; not audited");
        }
        vm.serializeString(m, "roles", rolesJson);
        string memory out = vm.serializeString(m, "contracts", contractsJson);

        string memory path = vm.envOr("V2_MANIFEST_OUT", string.concat("../deployments/", env, "-v2.json"));
        vm.writeJson(out, path);
        console2.log("manifest written to", path);
    }
}
