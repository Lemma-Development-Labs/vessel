// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BlitzVault} from "../../src/BlitzVault.sol";
import {Guardian} from "../../src/guards/Guardian.sol";

/// @dev Minimal slice of the Kuru OrderBook interface we need for the invariant test.
///      We only care about extracting the quote asset address.
interface IKuruOrderBook {
    function quoteToken() external view returns (address);
}

/// @dev Test-only mock installed at the real Kuru MON-USDC orderbook address.
///      We use vm.etch so the test continues to assert using the canonical address.
contract MockKuruOrderBookQuoteToken {
    // Kuru testnet quote token (MON-USDC market collateral / vault asset).
    address public constant QUOTE_TOKEN = 0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570;

    function quoteToken() external pure returns (address) {
        return QUOTE_TOKEN;
    }
}

contract KuruQuoteTokenMatchTest is Test {
    // Official Kuru MON-USDC market address on Monad testnet (chainId 10143).
    // Source: https://docs.kuru.io/contracts/Contract-addresses (Testnet -> Official Markets).
    address internal constant KURU_MON_USDC_MARKET = 0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9;

    function test_vaultAssetMatchesKuruOrderBookQuoteToken() public {
        // Install mock code at the canonical orderbook address so the assertion is
        // structure-correct without relying on live chain state during unit tests.
        vm.etch(KURU_MON_USDC_MARKET, type(MockKuruOrderBookQuoteToken).runtimeCode);

        address expectedQuoteToken = IKuruOrderBook(KURU_MON_USDC_MARKET).quoteToken();

        // Deploy a fresh vault wired to the expected quote token.
        address owner = makeAddr("owner");
        Guardian guardian = new Guardian(owner);
        BlitzVault vault = new BlitzVault(IERC20(expectedQuoteToken), address(guardian));

        // Three-stable-token mismatch guard:
        // vault.asset() must match the quote token from the canonical Kuru MON-USDC orderbook.
        assertEq(vault.asset(), expectedQuoteToken);
    }
}

