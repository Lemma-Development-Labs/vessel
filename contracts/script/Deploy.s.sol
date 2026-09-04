// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DemoUSD} from "../src/DemoUSD.sol";
import {Guardian} from "../src/guards/Guardian.sol";
import {BlitzVault} from "../src/BlitzVault.sol";
import {Tranches} from "../src/Tranches.sol";
import {SimVenue} from "../src/venues/SimVenue.sol";
import {PerplVenue} from "../src/venues/PerplVenue.stub.sol";
import {EngineLite} from "../src/EngineLite.sol";
import {MockWMON} from "../src/mocks/MockWMON.sol";
import {MockRouter} from "../src/mocks/MockRouter.sol";
import {KuruRouter} from "../src/venues/KuruRouter.sol";
import {IRouter} from "../src/interfaces/IRouter.sol";

/// @notice Deploys the Vessel machine and writes ../ADDRESSES.json
/// @dev Spot router selection:
///      - env SPOT_ROUTER=mock|kuru overrides
///      - default: mock on anvil (31337), kuru on Monad testnet (10143)
contract Deploy is Script {
    // Official Kuru testnet addresses — constructor args only, never baked into
    // KuruRouter.sol. Re-verify: https://docs.kuru.io/contracts/Contract-addresses
    address internal constant KURU_ORDER_BOOK = 0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9;
    address internal constant KURU_MARGIN = 0xd029C2D98ff85D8F64799017fE00a59B1159CE02;
    address internal constant KURU_USDC = 0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570;
    address internal constant WMON_TESTNET = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541;

    DemoUSD internal dusd;
    IERC20 internal quote;
    Guardian internal guardian;
    BlitzVault internal vault;
    Tranches internal tranches;
    SimVenue internal venue;
    PerplVenue internal perpl;
    MockWMON internal mockWmon;
    address internal wmon;
    IRouter internal router;
    EngineLite internal engine;
    string internal routerKind;
    string internal venueMode;

    function run() external {
        uint256 pk =
            vm.envOr("DEPLOYER_PK", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address deployer = vm.addr(pk);
        address owner = vm.envOr("PROTOCOL_OWNER", deployer);

        routerKind = vm.envOr("SPOT_ROUTER", block.chainid == 10143 ? string("kuru") : string("mock"));
        bool useKuru = _eq(routerKind, "kuru");
        venueMode = useKuru ? "kuru" : "sim";

        vm.startBroadcast(pk);

        guardian = new Guardian(owner);
        perpl = new PerplVenue();
        engine = new EngineLite(address(guardian));

        if (useKuru) {
            quote = IERC20(KURU_USDC);
            wmon = WMON_TESTNET;
            vault = new BlitzVault(quote, address(guardian));
            tranches = new Tranches(address(vault), address(guardian), owner);
            venue = new SimVenue(address(quote), owner);
            router = IRouter(
                address(new KuruRouter(KURU_ORDER_BOOK, KURU_MARGIN, address(quote), wmon))
            );
        } else {
            dusd = new DemoUSD();
            quote = IERC20(address(dusd));
            mockWmon = new MockWMON();
            wmon = address(mockWmon);
            vault = new BlitzVault(quote, address(guardian));
            tranches = new Tranches(address(vault), address(guardian), owner);
            venue = new SimVenue(address(quote), owner);
            MockRouter mockRouter = new MockRouter(address(quote), wmon);
            mockWmon.setRouter(address(mockRouter));
            router = IRouter(address(mockRouter));
        }

        vault.setEngine(address(engine));
        tranches.setEngine(address(engine));
        engine.wire(address(vault), address(tranches), address(venue), address(router), wmon);

        // Dead shares: deployer must hold 100 quote. Mock path faucets DemoUSD;
        // Kuru path requires the broadcaster already funded with Kuru USDC.
        if (!useKuru) {
            dusd.faucet();
        }
        quote.approve(address(vault), 100e6);
        vault.seedDeadShares(100e6);
        vault.setTranches(address(tranches));

        vm.stopBroadcast();

        uint256 seederPk =
            vm.envOr("SEEDER_PK", uint256(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d));
        require(seederPk != pk, "SEEDER_PK must differ from DEPLOYER_PK");
        vm.startBroadcast(seederPk);
        if (!useKuru) {
            dusd.faucet();
        }
        quote.approve(address(venue), 100e6);
        venue.seed(100e6);
        vm.stopBroadcast();

        _writeJson(useKuru);
    }

    function _writeJson(bool useKuru) internal {
        string memory c = "c";
        if (!useKuru) {
            vm.serializeAddress(c, "DemoUSD", address(dusd));
            vm.serializeAddress(c, "MockWMON", address(mockWmon));
            vm.serializeAddress(c, "MockRouter", address(router));
        } else {
            vm.serializeAddress(c, "KuruUSDC", address(quote));
            vm.serializeAddress(c, "WMON", wmon);
            vm.serializeAddress(c, "KuruRouter", address(router));
        }
        vm.serializeAddress(c, "Guardian", address(guardian));
        vm.serializeAddress(c, "BlitzVault", address(vault));
        vm.serializeAddress(c, "Tranches", address(tranches));
        vm.serializeAddress(c, "Hull", address(tranches.hullToken()));
        vm.serializeAddress(c, "Ballast", address(tranches.ballastToken()));
        vm.serializeAddress(c, "SimVenue", address(venue));
        vm.serializeAddress(c, "PerplVenue", address(perpl));
        string memory contractsJson = vm.serializeAddress(c, "EngineLite", address(engine));

        string memory r = "r";
        vm.serializeString(r, "rpcTestnet", "https://testnet-rpc.monad.xyz");
        vm.serializeString(r, "rpcMainnet", "https://rpc.monad.xyz");
        vm.serializeString(r, "explorerTestnet", "https://testnet.monadvision.com");
        vm.serializeString(r, "explorerMainnet", "https://monadvision.com");
        vm.serializeString(r, "wmonTestnet", "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541");
        vm.serializeString(r, "wmonMainnet", "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A");
        vm.serializeString(r, "kuruOrderBook", "0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9");
        vm.serializeString(r, "kuruMarginAccount", "0xd029C2D98ff85D8F64799017fE00a59B1159CE02");
        vm.serializeString(r, "kuruUsdc", "0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570");
        string memory refsJson = vm.serializeString(r, "puddleRouter", "0x430c23895c8D44883526e3E0B09327dAD8766660");

        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deployedBlock", block.number);
        vm.serializeString(root, "venue", venueMode);
        vm.serializeString(root, "spotRouter", routerKind);
        vm.serializeString(root, "contracts", contractsJson);
        string memory json = vm.serializeString(root, "refs", refsJson);
        vm.writeJson(json, "../ADDRESSES.json");
        console.log("spotRouter", routerKind);
        console.log("EngineLite", address(engine));
        console.log("router", address(router));
        console.log("wrote ../ADDRESSES.json");
    }

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
