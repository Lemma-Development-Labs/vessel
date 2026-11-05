// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BallastToken
/// @notice Junior units (spec §9). Readable like an ERC-20 so wallets can show a balance, but
///         beta units are non-transferable (D09): only the controller mints, burns, and moves
///         units into and out of exit escrow (`locked`). Locked units stay in totalSupply and
///         remain exposed to gains and losses until funded.
contract BallastToken {
    string public constant name = "Vessel Ballast";
    string public constant symbol = "BALLAST";
    uint8 public constant decimals = 18;

    address public immutable controller;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    /// @notice Units a holder has put into an exit request (still exposed, not spendable).
    mapping(address => uint256) public lockedOf;

    error NotController();
    error NonTransferable();
    error Insufficient();

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Locked(address indexed holder, uint256 units);
    event Unlocked(address indexed holder, uint256 units);

    constructor(address controller_) {
        controller = controller_;
    }

    modifier onlyController() {
        if (msg.sender != controller) revert NotController();
        _;
    }

    function mint(address to, uint256 units) external onlyController {
        totalSupply += units;
        balanceOf[to] += units;
        emit Transfer(address(0), to, units);
    }

    function lock(address holder, uint256 units) external onlyController {
        if (units > balanceOf[holder] - lockedOf[holder]) revert Insufficient();
        lockedOf[holder] += units;
        emit Locked(holder, units);
    }

    function unlock(address holder, uint256 units) external onlyController {
        if (units > lockedOf[holder]) revert Insufficient();
        lockedOf[holder] -= units;
        emit Unlocked(holder, units);
    }

    /// @notice Burn funded units out of a holder's locked balance.
    function burnLocked(address holder, uint256 units) external onlyController {
        if (units > lockedOf[holder]) revert Insufficient();
        lockedOf[holder] -= units;
        balanceOf[holder] -= units;
        totalSupply -= units;
        emit Transfer(holder, address(0), units);
    }

    function transfer(address, uint256) external pure returns (bool) {
        revert NonTransferable();
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert NonTransferable();
    }

    function approve(address, uint256) external pure returns (bool) {
        revert NonTransferable();
    }
}
