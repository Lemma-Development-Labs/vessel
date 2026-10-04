// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PauseGuardian
/// @notice Four independent pause dimensions (spec §20): admission, risk increase, valuation
///         settlement, claims. The guardian can only PAUSE. Only governance (intended: the
///         2-of-3 Safe behind a 48 h timelock) can resume. Neither can move funds, mint, or
///         change recipients — this contract holds no assets and calls nothing.
contract PauseGuardian {
    uint8 public constant ADMISSION = 1;
    uint8 public constant RISK_INCREASE = 2;
    uint8 public constant SETTLEMENT = 4;
    uint8 public constant CLAIMS = 8;
    uint8 internal constant ALL = ADMISSION | RISK_INCREASE | SETTLEMENT | CLAIMS;

    address public immutable guardian;
    address public immutable governance;
    uint8 public pausedMask;

    error NotGuardian();
    error NotGovernance();
    error BadDimension();
    error ZeroAddress();

    event Paused(uint8 dimensions, address indexed by);
    event Resumed(uint8 dimensions, address indexed by);

    constructor(address guardian_, address governance_) {
        if (guardian_ == address(0) || governance_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        governance = governance_;
    }

    function pause(uint8 dims) external {
        if (msg.sender != guardian && msg.sender != governance) revert NotGuardian();
        if (dims == 0 || dims & ~ALL != 0) revert BadDimension();
        pausedMask |= dims;
        emit Paused(dims, msg.sender);
    }

    /// @notice Resume requires governance. The guardian cannot unpause (spec §20).
    function resume(uint8 dims) external {
        if (msg.sender != governance) revert NotGovernance();
        if (dims == 0 || dims & ~ALL != 0) revert BadDimension();
        pausedMask &= ~dims;
        emit Resumed(dims, msg.sender);
    }

    function isPaused(uint8 dim) external view returns (bool) {
        return pausedMask & dim != 0;
    }
}
