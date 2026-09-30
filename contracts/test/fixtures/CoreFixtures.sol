// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IStrategyEngine} from "../../src/core/interfaces/ICore.sol";

/// @notice TEST FIXTURE — never deployed to mainnet. 6-decimal stand-in for USDC.
contract TestUSDC is ERC20 {
    constructor() ERC20("Test USDC", "tUSDC") {
        if (block.chainid == 143) revert("test fixture on mainnet");
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

/// @notice TEST FIXTURE — SIMULATED engine. Holds USDC sent by custody; tests move its value up
///         or down to stand in for hedge PnL and funding. Releases only to the fixed custody.
///         Refuses to exist on mainnet (chain 143).
contract TestEngine is IStrategyEngine {
    TestUSDC public immutable usdc;
    address public custody;
    uint256 public lastObservedAt;
    bool public stale;

    constructor(TestUSDC usdc_) {
        if (block.chainid == 143) revert("simulated engine on mainnet");
        usdc = usdc_;
    }

    function setCustody(address custody_) external {
        require(custody == address(0), "custody set");
        custody = custody_;
    }

    function value() external view returns (uint256, uint256) {
        return (usdc.balanceOf(address(this)), stale ? 1 : block.timestamp);
    }

    function release(uint256 amount) external {
        require(msg.sender == custody, "only custody");
        usdc.transfer(custody, amount);
    }

    /// @notice Simulated strategy result: positive mints, negative burns.
    function applyPnl(int256 pnl) external {
        if (pnl >= 0) usdc.mint(address(this), uint256(pnl));
        else usdc.burn(address(this), uint256(-pnl));
    }

    function setStale(bool s) external {
        stale = s;
    }
}
