// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title VesselTestMON — TESTNET ONLY, NO VALUE
/// @notice vMON: the spot leg's stand-in for MON on Monad testnet (ADR-010), because enough testnet
///         MON to quote Vessel's Kuru markets could not be sourced. Vessel's own Kuru markets quote
///         it at the Perpl MON mark, so the engine's spot leg moves with MON while its Perpl short
///         is real. It is not MON, is not redeemable for anything, and the constructor refuses
///         Monad mainnet (chain 143). Only the deployer can mint.
contract VesselTestMON is ERC20 {
    address public immutable minter;

    error Mainnet();
    error NotMinter();
    error ZeroAddress();

    constructor(address minter_) ERC20("Vessel test MON (testnet, no value)", "vMON") {
        if (block.chainid == 143) revert Mainnet();
        if (minter_ == address(0)) revert ZeroAddress();
        minter = minter_;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        _mint(to, amount);
    }
}
