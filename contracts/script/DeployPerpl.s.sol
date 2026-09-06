// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PerplPositionReader} from "../src/venues/PerplPositionReader.sol";
import {PerplVenue} from "../src/venues/PerplVenue.sol";

/// @title DeployPerpl
/// @notice Deploys `PerplPositionReader` + `PerplVenue` against the *live* Perpl
///         Exchange proxy on Monad testnet (chain 10143). Does not place orders.
/// @dev Env:
///        DEPLOYER_PK       — required (no Anvil default; refuse silent broadcast)
///        PERPL_EXCHANGE    — default 0x1964…80cc (testnet proxy)
///        PERPL_MARKET_ID   — default 64 (MON)
///        PERPL_PRICE_DECIMALS — default 5
///        PERPL_LOT_DECIMALS   — default 0
///        PERPL_POSITION_OWNER — keeper EOA that owns the Perpl account (required)
///        PERPL_MAX_DEVIATION_BPS — default 100
///
///      Example:
///        forge script script/DeployPerpl.s.sol:DeployPerpl --rpc-url $RPC \
///          --broadcast --private-key $DEPLOYER_PK -vv
contract DeployPerpl is Script {
    address internal constant DEFAULT_EXCHANGE = 0x1964C32f0bE608E7D29302AFF5E61268E72080cc;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address exchange = vm.envOr("PERPL_EXCHANGE", DEFAULT_EXCHANGE);
        uint256 marketId = vm.envOr("PERPL_MARKET_ID", uint256(64));
        uint256 priceDecimals = vm.envOr("PERPL_PRICE_DECIMALS", uint256(5));
        uint256 lotDecimals = vm.envOr("PERPL_LOT_DECIMALS", uint256(0));
        address positionOwner = vm.envAddress("PERPL_POSITION_OWNER");
        uint256 maxDeviationBps = vm.envOr("PERPL_MAX_DEVIATION_BPS", uint256(100));

        require(exchange.code.length > 0, "PERPL_EXCHANGE has no code");
        require(positionOwner != address(0), "PERPL_POSITION_OWNER required");

        vm.startBroadcast(pk);
        PerplPositionReader reader = new PerplPositionReader(exchange, marketId, priceDecimals, lotDecimals);
        PerplVenue venue = new PerplVenue(address(reader), positionOwner, maxDeviationBps);
        vm.stopBroadcast();

        console.log("PERPL_POSITION_READER", address(reader));
        console.log("PERPL_VENUE", address(venue));
        console.log("PERPL_EXCHANGE", exchange);
        console.log("PERPL_MARKET_ID", marketId);
        console.log("PERPL_POSITION_OWNER", positionOwner);
        console.log("PERPL_MAX_DEVIATION_BPS", maxDeviationBps);
        console.log("NOTE: append addresses + deploy tx to docs/ADDRESSES.md shipped hashes");
        console.log("NOTE: TX_PERPL_SHORT stays pending until keeper posts off-chain short");
    }
}
