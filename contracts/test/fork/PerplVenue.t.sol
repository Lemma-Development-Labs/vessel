// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PerplPositionReader} from "../../src/venues/PerplPositionReader.sol";
import {PerplVenue} from "../../src/venues/PerplVenue.sol";

/// @notice Fork tests against live Perpl Exchange on Monad testnet (chain 10143).
/// @dev Run: forge test --match-path test/fork/PerplVenue.t.sol --fork-url $MONAD_TESTNET_RPC -vv
contract PerplVenueForkTest is Test {
    address internal constant EXCHANGE = 0x1964C32f0bE608E7D29302AFF5E61268E72080cc;
    uint256 internal constant MARKET_MON = 64;
    // Account 1 held a live MON short when probed 2026-09-06 (see session cast log).
    uint256 internal constant SAMPLE_ACCOUNT = 1;
    address internal constant SAMPLE_OWNER = 0xA91F9339E65d6d0DED8861aA91de9E6AE9910CAb;

    PerplPositionReader internal reader;
    PerplVenue internal venue;

    function setUp() public {
        // Skip cleanly when not forked (no code at exchange).
        if (EXCHANGE.code.length == 0) {
            vm.skip(true);
        }
        reader = new PerplPositionReader(EXCHANGE, MARKET_MON, 5, 0);
        venue = new PerplVenue(address(reader), SAMPLE_OWNER, 100);
    }

    function testFork_readerReturnsLivePosition_market64() public view {
        (uint256 id, uint256 b0) = reader.accountId(SAMPLE_OWNER);
        assertEq(id, SAMPLE_ACCOUNT);
        assertGt(b0, 0);

        (int256 size, uint256 entry, uint256 margin, int256 funding, uint256 b1) = reader.position(SAMPLE_ACCOUNT);
        // Live book may flatten; if open, short ⇒ negative size.
        if (size != 0) {
            assertTrue(size < 0, "sample account expected short when open");
            assertGt(entry, 0);
            assertGt(margin, 0);
        }
        // funding may be zero — that is an on-chain value, not a fabricated default.
        funding;
        assertEq(b1, block.number);
    }

    function testFork_readerRevertsFieldNotOnChain_whenUnexposed() public {
        vm.expectRevert(abi.encodeWithSelector(PerplPositionReader.FieldNotOnChain.selector, "liquidationPrice"));
        reader.liquidationPrice(SAMPLE_ACCOUNT);
    }

    function testFork_netDeltaMatchesHandComputed() public view {
        (int256 n,) = reader.notionalQuote(SAMPLE_ACCOUNT);
        uint256 shortN = n < 0 ? uint256(-n) : uint256(n);
        uint256 spot = shortN + 7e6; // arbitrary spot inventory for the identity check
        (int256 delta,) = venue.netDelta(spot);
        assertEq(delta, int256(spot) - int256(shortN));
    }
}
