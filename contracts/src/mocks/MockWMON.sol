// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockWMON
/// @notice Test/sim WMON. Router is the only minter.
contract MockWMON is ERC20 {
    address public router;

    error NotRouter();

    constructor() ERC20("Wrapped Monad", "WMON") {}

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function setRouter(address router_) external {
        if (router_ == address(0) || router != address(0)) revert NotRouter();
        router = router_;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != router) revert NotRouter();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != router) revert NotRouter();
        _burn(from, amount);
    }
}
