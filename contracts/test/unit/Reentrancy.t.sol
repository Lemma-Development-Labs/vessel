// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BlitzVault} from "../../src/BlitzVault.sol";
import {Guardian} from "../../src/guards/Guardian.sol";
import {EngineLite} from "../../src/EngineLite.sol";
import {Tranches} from "../../src/Tranches.sol";
import {DemoUSD} from "../../src/DemoUSD.sol";
import {SimVenue} from "../../src/venues/SimVenue.sol";
import {MockWMON} from "../../src/mocks/MockWMON.sol";
import {MockRouter} from "../../src/mocks/MockRouter.sol";
import {IVenue} from "../../src/interfaces/IVenue.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract HookToken is ERC20 {
    address public hook;
    bytes public data;
    bool public armed;

    constructor() ERC20("Hook", "HOOK") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }

    function arm(address hook_, bytes calldata data_) external {
        hook = hook_;
        data = data_;
        armed = true;
    }

    function transferFrom(address from, address to, uint256 amt) public override returns (bool) {
        bool ok = super.transferFrom(from, to, amt);
        if (armed && hook != address(0)) {
            armed = false;
            (bool success, bytes memory ret) = hook.call(data);
            // Bubble the inner revert verbatim so tests can assert *why* the callback failed.
            if (!success) {
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
        return ok;
    }
}

contract ReenteringVenue is IVenue {
    EngineLite public engine;
    bool public reenterCrank;

    function armReenter() external {
        reenterCrank = true;
    }
    uint256 public nextId = 1;

    function setEngine(EngineLite e) external {
        engine = e;
    }

    function openShort(uint256) external returns (uint256 id) {
        id = nextId++;
    }

    function closeShort(uint256) external pure returns (int256) {
        return 0;
    }

    function position(uint256) external pure returns (uint256, int256) {
        return (0, 0);
    }

    function sweepFunding(uint256) external returns (int256) {
        if (reenterCrank) {
            engine.crank();
        }
        return 0;
    }

    function venueName() external pure returns (string memory) {
        return "reenter";
    }

    function isSimulated() external pure returns (bool) {
        return true;
    }
}

contract ReentrancyTest is Test {
    /// @dev The asset token calls back into the vault mid-`deposit` (inside `transferIn`).
    ///      Two independent gates must stop it: the shared ReentrancyGuard, and NotTranches.
    function _reentrancyRig() internal returns (HookToken token, BlitzVault vault) {
        token = new HookToken();
        Guardian guardian = new Guardian(address(this));
        vault = new BlitzVault(token, address(guardian));
        vault.setEngine(address(this));

        token.mint(address(this), 1_000e6);
        token.approve(address(vault), type(uint256).max);
        // Seed while unarmed, then hand the minting role to this test contract.
        vault.seedDeadShares(100e6);
        vault.setTranches(address(this));
    }

    function test_maliciousTokenCannotReenterVaultDuringDeposit() public {
        (HookToken token, BlitzVault vault) = _reentrancyRig();

        // Re-enter a non-gated mutative function: only the ReentrancyGuard can stop this.
        token.arm(
            address(vault), abi.encodeWithSelector(vault.withdraw.selector, uint256(1), address(this), address(this))
        );
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vault.deposit(10e6, address(this));
    }

    function test_maliciousTokenCannotReenterDeposit() public {
        (HookToken token, BlitzVault vault) = _reentrancyRig();

        // Re-entering deposit itself is stopped by the minting gate: the callback's
        // msg.sender is the token, not Tranches.
        token.arm(address(vault), abi.encodeWithSelector(vault.deposit.selector, 1e6, address(this)));
        vm.expectRevert(BlitzVault.NotTranches.selector);
        vault.deposit(10e6, address(this));
    }

    function test_maliciousVenueCannotReenterCrank() public {
        DemoUSD dusd = new DemoUSD();
        Guardian guardian = new Guardian(address(this));
        BlitzVault vault = new BlitzVault(dusd, address(guardian));
        Tranches tranches = new Tranches(address(vault), address(guardian), address(this));
        ReenteringVenue venue = new ReenteringVenue();
        MockWMON wmon = new MockWMON();
        MockRouter router = new MockRouter(address(dusd), address(wmon));
        wmon.setRouter(address(router));
        EngineLite engine = new EngineLite(address(guardian));
        vault.setEngine(address(engine));
        tranches.setEngine(address(engine));
        engine.wire(address(vault), address(tranches), address(venue), address(router), address(wmon));
        venue.setEngine(engine);
        venue.armReenter();

        dusd.faucet();
        dusd.approve(address(vault), 100e6);
        vault.seedDeadShares(100e6);
        vault.setTranches(address(tranches));

        vm.warp(block.timestamp + 1 hours);
        dusd.faucet();
        dusd.approve(address(tranches), 100e6);
        tranches.joinBallast(100e6);
        uint256 minBase = router.quoteExactQuoteForBase(vault.deployable() / 2);
        engine.deployLiquidity(minBase);

        vm.warp(block.timestamp + 1);
        vm.expectRevert();
        engine.crank();
    }
}
