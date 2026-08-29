// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DemoUSD} from "../src/DemoUSD.sol";
import {Guardian} from "../src/guards/Guardian.sol";
import {BlitzVault} from "../src/BlitzVault.sol";
import {Tranches} from "../src/Tranches.sol";
import {SimVenue} from "../src/venues/SimVenue.sol";
import {PerplVenue} from "../src/venues/PerplVenue.stub.sol";
import {EngineLite} from "../src/EngineLite.sol";
import {MockWMON} from "../src/mocks/MockWMON.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";

/// @notice Deploys the Vessel machine and writes ../ADDRESSES.json
contract Deploy is Script {
    DemoUSD internal dusd;
    Guardian internal guardian;
    BlitzVault internal vault;
    Tranches internal tranches;
    SimVenue internal venue;
    PerplVenue internal perpl;
    MockWMON internal wmon;
    MockRouter internal router;
    EngineLite internal engine;

    function run() external {
        uint256 pk =
            vm.envOr("DEPLOYER_PK", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        dusd = new DemoUSD();
        guardian = new Guardian(deployer);
        vault = new BlitzVault(dusd, address(guardian));
        tranches = new Tranches(address(vault), address(guardian), deployer);
        venue = new SimVenue(address(dusd));
        perpl = new PerplVenue();
        wmon = new MockWMON();
        router = new MockRouter(address(dusd), address(wmon));
        wmon.setRouter(address(router));
        engine = new EngineLite(address(guardian));

        vault.setEngine(address(engine));
        tranches.setEngine(address(engine));
        engine.wire(address(vault), address(tranches), address(venue), address(router), address(wmon));

        dusd.faucet();
        dusd.approve(address(vault), 100e6);
        vault.deposit(100e6, address(0x000000000000000000000000000000000000dEaD));

        vm.stopBroadcast();

        uint256 seederPk =
            vm.envOr("SEEDER_PK", uint256(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d));
        require(seederPk != pk, "SEEDER_PK must differ from DEPLOYER_PK");
        vm.startBroadcast(seederPk);
        dusd.faucet();
        dusd.approve(address(venue), 100e6);
        venue.seed(100e6);
        vm.stopBroadcast();

        _writeJson();
    }

    function _writeJson() internal {
        string memory c = "c";
        vm.serializeAddress(c, "DemoUSD", address(dusd));
        vm.serializeAddress(c, "Guardian", address(guardian));
        vm.serializeAddress(c, "BlitzVault", address(vault));
        vm.serializeAddress(c, "Tranches", address(tranches));
        vm.serializeAddress(c, "Hull", address(tranches.hullToken()));
        vm.serializeAddress(c, "Ballast", address(tranches.ballastToken()));
        vm.serializeAddress(c, "SimVenue", address(venue));
        vm.serializeAddress(c, "PerplVenue", address(perpl));
        vm.serializeAddress(c, "EngineLite", address(engine));
        vm.serializeAddress(c, "MockWMON", address(wmon));
        string memory contractsJson = vm.serializeAddress(c, "MockRouter", address(router));

        string memory r = "r";
        vm.serializeString(r, "rpcTestnet", "https://testnet-rpc.monad.xyz");
        vm.serializeString(r, "rpcMainnet", "https://rpc.monad.xyz");
        vm.serializeString(r, "explorerTestnet", "https://testnet.monadvision.com");
        vm.serializeString(r, "explorerMainnet", "https://monadvision.com");
        vm.serializeString(r, "wmonTestnet", "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541");
        vm.serializeString(r, "wmonMainnet", "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A");
        string memory refsJson = vm.serializeString(r, "puddleRouter", "0x430c23895c8D44883526e3E0B09327dAD8766660");

        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deployedBlock", block.number);
        vm.serializeString(root, "venue", "sim");
        vm.serializeString(root, "contracts", contractsJson);
        string memory json = vm.serializeString(root, "refs", refsJson);
        vm.writeJson(json, "../ADDRESSES.json");
        console.log("DemoUSD", address(dusd));
        console.log("EngineLite", address(engine));
        console.log("wrote ../ADDRESSES.json");
    }
}
