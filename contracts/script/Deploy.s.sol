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
    function run() external {
        uint256 pk =
            vm.envOr("DEPLOYER_PK", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        DemoUSD dusd = new DemoUSD();
        Guardian guardian = new Guardian(deployer);
        BlitzVault vault = new BlitzVault(dusd, address(guardian));
        Tranches tranches = new Tranches(address(vault), address(guardian), deployer);
        SimVenue venue = new SimVenue(address(dusd));
        PerplVenue perpl = new PerplVenue();
        MockWMON wmon = new MockWMON();
        MockRouter router = new MockRouter(address(dusd), address(wmon));
        wmon.setRouter(address(router));
        EngineLite engine = new EngineLite(address(guardian));

        vault.setEngine(address(engine));
        tranches.setEngine(address(engine));
        engine.wire(address(vault), address(tranches), address(venue), address(router), address(wmon));

        dusd.faucet();
        dusd.approve(address(venue), 100e6);
        venue.seed(100e6);

        vm.stopBroadcast();

        string memory json = string.concat(
            "{\n",
            '  "chainId": ',
            vm.toString(block.chainid),
            ",\n",
            '  "deployedBlock": ',
            vm.toString(block.number),
            ",\n",
            '  "venue": "sim",\n',
            '  "contracts": {\n',
            '    "DemoUSD": "',
            vm.toString(address(dusd)),
            '",\n',
            '    "Guardian": "',
            vm.toString(address(guardian)),
            '",\n',
            '    "BlitzVault": "',
            vm.toString(address(vault)),
            '",\n',
            '    "Tranches": "',
            vm.toString(address(tranches)),
            '",\n',
            '    "Hull": "',
            vm.toString(address(tranches.hullToken())),
            '",\n',
            '    "Ballast": "',
            vm.toString(address(tranches.ballastToken())),
            '",\n',
            '    "SimVenue": "',
            vm.toString(address(venue)),
            '",\n',
            '    "PerplVenue": "',
            vm.toString(address(perpl)),
            '",\n',
            '    "EngineLite": "',
            vm.toString(address(engine)),
            '",\n',
            '    "MockWMON": "',
            vm.toString(address(wmon)),
            '",\n',
            '    "MockRouter": "',
            vm.toString(address(router)),
            '"\n',
            "  },\n",
            '  "refs": {\n',
            '    "rpcTestnet": "https://testnet-rpc.monad.xyz",\n',
            '    "rpcMainnet": "https://rpc.monad.xyz",\n',
            '    "explorerTestnet": "https://testnet.monadvision.com",\n',
            '    "explorerMainnet": "https://monadvision.com",\n',
            '    "wmonTestnet": "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541",\n',
            '    "wmonMainnet": "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",\n',
            '    "puddleRouter": "0x430c23895c8D44883526e3E0B09327dAD8766660"\n',
            "  }\n",
            "}\n"
        );
        vm.writeFile("../ADDRESSES.json", json);
        console.log("DemoUSD", address(dusd));
        console.log("EngineLite", address(engine));
        console.log("wrote ../ADDRESSES.json");
    }
}
