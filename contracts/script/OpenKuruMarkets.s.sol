// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Vm} from "forge-std/Vm.sol";

interface IKuruRouterDeploy {
    function deployProxy(
        uint8 _type,
        address _baseAssetAddress,
        address _quoteAssetAddress,
        uint96 _sizePrecision,
        uint32 _pricePrecision,
        uint32 _tickSize,
        uint96 _minSize,
        uint96 _maxSize,
        uint256 _takerFeeBps,
        uint256 _makerFeeBps,
        uint96 _kuruAmmSpread
    ) external returns (address proxy);
}

/// @notice Open Vessel's own Kuru markets on Monad TESTNET (ADR-009): MON/USDC against Circle
///         USDC and MON/AUSD against Perpl's collateral. Kuru's `deployProxy` is permissionless.
///         Opening a market moves no money; seeding liquidity is a separate step that needs
///         test MON (FACT_CHECKS.md). Mainnet uses Kuru's official markets and never runs this.
///
/// Env: DEPLOYER_PK, optional KURU_MARKETS_OUT (default ../deployments/testnet-kuru-markets.json)
contract OpenKuruMarkets is Script {
    IKuruRouterDeploy constant ROUTER = IKuruRouterDeploy(0x7EFbE105Ca7415dE98F96622173458ac1c054630);
    address constant USDC = 0x534b2f3A21130d7a60830c2Df862319e593943A3; // Circle, Monad testnet
    address constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC; // Perpl testnet collateral

    uint8 constant NATIVE_IN_BASE = 1;
    // MON ≈ $0.03: 1e8 price precision gives a $0.000001 tick (~3 bps); sizes in 1e-10 MON.
    uint96 constant SIZE_PRECISION = 1e10;
    uint32 constant PRICE_PRECISION = 1e8;
    uint32 constant TICK = 100;
    uint96 constant MIN_SIZE = 1e10; // 1 MON
    uint96 constant MAX_SIZE = 1e18; // 1e8 MON
    uint256 constant TAKER_FEE_BPS = 0;
    uint256 constant MAKER_FEE_BPS = 0;
    uint96 constant AMM_SPREAD = 100;

    function run() external returns (address monUsdc, address monAusd) {
        require(block.chainid == 10143 || block.chainid == 31337, "OpenKuruMarkets: Monad testnet only");
        uint256 pk = vm.envUint("DEPLOYER_PK");
        vm.recordLogs();
        vm.startBroadcast(pk);
        monUsdc = _open(USDC);
        monAusd = _open(AUSD);
        vm.stopBroadcast();
        Vm.Log[] memory logs = vm.getRecordedLogs(); // read once: the call drains the buffer
        (address usdcVault, address ausdVault) = (_vault(logs, monUsdc), _vault(logs, monAusd));

        string memory k = "kuru";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "openedBlock", block.number);
        vm.serializeAddress(k, "router", address(ROUTER));
        vm.serializeAddress(k, "usdc", USDC);
        vm.serializeAddress(k, "ausd", AUSD);
        vm.serializeAddress(k, "monUsdc", monUsdc);
        vm.serializeAddress(k, "monUsdcVault", usdcVault);
        vm.serializeAddress(k, "monAusd", monAusd);
        vm.serializeAddress(k, "monAusdVault", ausdVault);
        string memory out = vm.serializeString(
            k,
            "params",
            "NATIVE_IN_BASE, sizePrecision 1e10, pricePrecision 1e8, tick 100, min 1 MON, fees 0, ammSpread 100"
        );
        string memory path = vm.envOr("KURU_MARKETS_OUT", string("../deployments/testnet-kuru-markets.json"));
        vm.writeJson(out, path);
        console2.log("MON/USDC", monUsdc);
        console2.log("MON/AUSD", monAusd);
        console2.log("written to", path);
    }

    function _open(address quote) internal returns (address) {
        return ROUTER.deployProxy(
            NATIVE_IN_BASE,
            address(0),
            quote,
            SIZE_PRECISION,
            PRICE_PRECISION,
            TICK,
            MIN_SIZE,
            MAX_SIZE,
            TAKER_FEE_BPS,
            MAKER_FEE_BPS,
            AMM_SPREAD
        );
    }

    /// @dev The vault address comes from Kuru's MarketRegistered event.
    function _vault(Vm.Log[] memory logs, address market) internal pure returns (address) {
        bytes32 topic = keccak256(
            "MarketRegistered(address,address,address,address,uint32,uint96,uint32,uint96,uint96,uint256,uint256,uint96)"
        );
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == topic) {
                (,, address m, address v) = abi.decode(logs[i].data, (address, address, address, address));
                if (m == market) return v;
            }
        }
        return address(0);
    }
}
