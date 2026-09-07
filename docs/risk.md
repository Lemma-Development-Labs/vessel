# /risk

## Venue (capacity / funding)

- Perpl open interest (OI) is the practical capacity cap for the hedge: if the market is thin, you do not have a hedge with the size you want.
- Funding sign can flip frequently. A strategy that assumes “typical” funding without checking the on-chain (or indexer) tape is at risk.
- Hedge verification is only as good as the ability to read the exchange position + funding feed you claim to be using.

## Tranche wipe: Ballast can go to zero

Ballast is the first-loss underwriting seat. In stress, Ballast (and then reserve) absorb losses before Hull. If losses exceed the remaining protection, Ballast can be wiped out. Hull is protected only while Ballast and reserve still exist.

## The three-stable mismatch (explicit disclosure)

There are **three different dollar tokens** on Monad testnet (chainId `10143`). Never assume any two are the same token:

- **Circle USDC** (exists; **no Kuru market**): `0x534b2f3A21130d7a60830c2Df862319e593943A3`
- **Kuru testnet USDC** (the **vault asset** / quote token of the official MON-USDC market): `0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570`
- **Perpl testnet collateral ("USD")** (Perpl margin only; sourced from Perpl’s faucet, **not** swapped from the vault): `0xdf5b718d8fcc173335185a2a1513ee8151e3c027`

Mainnet AUSD at `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` does **not** exist on testnet. If you reuse mainnet addresses in a testnet path, you have failed the session.

## Keeper custody + key loss

This system is permissionlessly crankable, but keeper operations do require custody of the right keys and reliable transaction submission. If the keeper key is lost or never funded, the hedge can stop being maintained and your waterfall can become stale.

## Oracle / price risk on a thin CLOB

Any “spot” mark derived from a pool or order book is vulnerable to manipulation on thin markets. Even if the short leg is correct, the net delta can be wrong if the mark you use is stale or manipulable.

## Unaudited / testnet / valueless tokens

Everything here is testnet and unaudited. “Demo dollars” and other testnet tokens can be valueless outside the test environment.

## Resolv (USR/RLP) dual-tranche caution

Resolv (USR/RLP, exploited March 2026) is our direct cautionary analog: dual-tranche designs can fail in ways that look “locally correct” (accounting invariants hold) but still break economically via routing, oracle/mark choices, or mismatch between the hedged asset and the collateral identity. Readers should raise this concern first.

## Not Vessel Finance

This is **not** Vessel Finance (`vessel.finance` is a different ZK order-book DEX).

