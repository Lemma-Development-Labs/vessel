// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title DemoUSD
/// @notice Valueless demo token ("Vessel Demo Dollar", dUSD). 6 decimals.
///         It has NO economic value. There is no privileged mint — the only
///         issuance path is the public faucet, capped per address.
contract DemoUSD is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 100 * 1e6;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;
    uint256 public constant LIFETIME_CAP = 1_000 * 1e6;

    mapping(address => uint256) public lastFaucetAt;
    mapping(address => uint256) public mintedLifetime;

    error FaucetCooldown(uint256 secondsLeft);
    error FaucetCap();

    constructor() ERC20("Vessel Demo Dollar", "dUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint 100 dUSD to the caller. 1 hour cooldown, 1,000 dUSD lifetime cap.
    function faucet() external {
        uint256 last = lastFaucetAt[msg.sender];
        if (last != 0) {
            uint256 elapsed = block.timestamp - last;
            if (elapsed < FAUCET_COOLDOWN) {
                revert FaucetCooldown(FAUCET_COOLDOWN - elapsed);
            }
        }
        if (mintedLifetime[msg.sender] + FAUCET_AMOUNT > LIFETIME_CAP) revert FaucetCap();
        lastFaucetAt[msg.sender] = block.timestamp;
        mintedLifetime[msg.sender] += FAUCET_AMOUNT;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit Faucet(msg.sender, FAUCET_AMOUNT);
    }

    event Faucet(address indexed to, uint256 amount);
}
