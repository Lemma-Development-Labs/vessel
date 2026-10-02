// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

interface ISafeProxyFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

interface ISafe {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
}

/// @notice Create a governance Safe on a TEST network from signer ADDRESSES only — no signer
///         key is ever needed. Uses the canonical Safe v1.4.1 deployment (SafeL2 + compatibility
///         fallback handler, the same configuration as the previous testnet Safe). The deployer
///         pays gas and is refused as an owner, so it keeps no role.
///
/// Env: DEPLOYER_PK, SAFE_OWNERS (comma-separated addresses), optional SAFE_THRESHOLD (default 2),
///      SAFE_SALT (default derived from owners + threshold), SAFE_OUT (default ../deployments/<chain>-safe.json)
contract CreateSafe is Script {
    address internal constant FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address internal constant SAFE_L2 = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    address internal constant FALLBACK_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;

    function run() external returns (address safe) {
        if (block.chainid == 143) revert("CreateSafe: mainnet governance goes through the release process");
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(pk);
        address[] memory owners = vm.envAddress("SAFE_OWNERS", ",");
        uint256 threshold = vm.envOr("SAFE_THRESHOLD", uint256(2));

        require(threshold >= 2 && threshold <= owners.length, "CreateSafe: need 2 <= threshold <= owners");
        for (uint256 i; i < owners.length; i++) {
            require(owners[i] != address(0), "CreateSafe: zero owner");
            require(owners[i] != deployer, "CreateSafe: the deployer must not be a signer");
            for (uint256 j; j < i; j++) {
                require(owners[i] != owners[j], "CreateSafe: duplicate owner");
            }
        }
        require(
            FACTORY.code.length > 0 && SAFE_L2.code.length > 0 && FALLBACK_HANDLER.code.length > 0,
            "CreateSafe: Safe v1.4.1 not deployed on this chain"
        );

        bytes memory init = abi.encodeCall(
            ISafe.setup, (owners, threshold, address(0), "", FALLBACK_HANDLER, address(0), 0, payable(address(0)))
        );
        uint256 salt = vm.envOr("SAFE_SALT", uint256(keccak256(abi.encode("vessel-safe", owners, threshold))));

        vm.startBroadcast(pk);
        safe = ISafeProxyFactory(FACTORY).createProxyWithNonce(SAFE_L2, init, salt);
        vm.stopBroadcast();

        // Read back what the chain now says before anyone relies on it.
        address[] memory got = ISafe(safe).getOwners();
        require(ISafe(safe).getThreshold() == threshold, "CreateSafe: threshold mismatch");
        require(got.length == owners.length, "CreateSafe: owner count mismatch");
        for (uint256 i; i < owners.length; i++) {
            bool found;
            for (uint256 j; j < got.length; j++) {
                if (got[j] == owners[i]) found = true;
            }
            require(found, "CreateSafe: owner missing after setup");
        }

        string memory k = "safe";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "threshold", threshold);
        vm.serializeAddress(k, "owners", owners);
        vm.serializeAddress(k, "singleton", SAFE_L2);
        vm.serializeAddress(k, "fallbackHandler", FALLBACK_HANDLER);
        vm.serializeUint(k, "createdBlock", block.number);
        string memory out = vm.serializeAddress(k, "safe", safe);
        string memory env = block.chainid == 10143 ? "testnet" : "local";
        string memory path = vm.envOr("SAFE_OUT", string.concat("../deployments/", env, "-safe.json"));
        vm.writeJson(out, path);
        console2.log("safe", safe);
        console2.log("written to", path);
    }
}
