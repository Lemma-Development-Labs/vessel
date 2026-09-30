# FACT_CHECKS

Claims about external systems and deployed state, with evidence. Chain facts
below were read directly via `cast` (Foundry 1.8.1) on **2026-09-23** at the
pinned finalized blocks stated in each section. Re-verify before any deployment
(spec §4). Rows marked **UNVERIFIED** are documentary claims from
[docs/spec/VESSEL_V1.md](spec/VESSEL_V1.md) (checked by its author on
2026-09-22 against the S1–S12 sources) that this repository has not yet
independently confirmed.

## Monad mainnet references (chain 143)

RPC `https://rpc.monad.xyz` · pinned finalized block **107397766**
(`0x37841b0607f85b2a6456c125834b145cc515766b4e554d3f82b0d4d08b0bc9df`,
timestamp 1790189618 = 2026-09-23T18:53:38Z). These are read-only reference
checks, **not** authorization to send funds. No Vessel contracts exist on
mainnet.

| Claim | Address | Evidence at pinned block | Status |
|---|---|---|---|
| Mainnet chain ID is 143 | — | `cast chain-id` → 143 | VERIFIED |
| Circle USDC, 6 decimals | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | codesize 1798; `decimals()` → 6; `symbol()` → "USDC" | VERIFIED (proxy; EIP-1967 impl slot empty — Circle legacy proxy pattern, implementation resolution pending) |
| AUSD, 6 decimals | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` | codesize 5937; `decimals()` → 6; `symbol()` → "AUSD" | VERIFIED |
| WMON, 18 decimals | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` | codesize 3249; `decimals()` → 18; `symbol()` → "WMON" | VERIFIED |
| Kuru MON/USDC market | `0x065C9d28E428A0db40191a54d33d5b7c71a9C394` | codesize 141 (proxy); EIP-1967 impl `0x5e3446c600524be453bbcefd46a9e4c9be8899a0` | CODE PRESENT — market semantics UNVERIFIED (G02) |
| Kuru MON/AUSD market | `0x131a2e70a5b31a517a74b8c567149bc294470da9` | codesize 141 (proxy); same impl `0x5e34…99a0` as MON/USDC | CODE PRESENT — shared implementation consistent with a market factory; semantics UNVERIFIED (G02) |
| Perpl Exchange | `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` | codesize 225 (proxy); EIP-1967 impl `0xa9ab97a404a0bca04d6a5b4a39995fea9e791b2a` | CODE PRESENT — ABI, account model, market ID UNVERIFIED (G01/G02) |

Venue proxies are upgradeable by their operators: monitor implementation-slot
changes before and during any integration (spec §20).

## Monad testnet — current live deployment (chain 10143)

RPC `https://testnet-rpc.monad.xyz` · `cast chain-id` → 10143 · pinned
finalized block **65090419**
(`0x1740b6995f153495cc67d1cd60929a9150164f72a107d373b60899d847c63677`).
Deployment manifest: working-tree `ADDRESSES.json` (`deployedBlock` 57923009),
produced by commit b9ce063 ("redeploy behind a Safe").

All eleven manifest addresses have code at the pinned block:

| Contract | Address | codesize |
|---|---|---|
| DemoUSD | `0x959E54DcF8576856F7A9424190a9751c68739495` | 2334 |
| Guardian | `0x75Bf4C326f054e655C7C138cD847154fEB3bAC19` | 894 |
| BlitzVault | `0x27eE1688F8b07E2aa767a4B4f4b90040E3ABC55d` | 8192 |
| Tranches | `0x7Df78EA918FA4531a74b79CE0a53a6D94B72E373` | 7242 |
| Hull | `0x9638da84aA4b30fB9350bb2cA33DCf0b81Ab3Bd2` | 2254 |
| Ballast | `0xCD694B5C79D12708F11FB1adF1594e8e71de650D` | 2254 |
| EngineLite | `0x60eC904955CA843285B24E3F6e7e2034F8f96140` | 7328 |
| SimVenue | `0xD8730205Ab716Bc2FcA2FfF653e1390DFC4Fe85d` | 2592 |
| PerplVenue (stub) | `0x59fc4C09eF7Dc0b754B74d7AEe21EeAC1c94aD6C` | 447 |
| MockWMON | `0xEf6Cc6228A39cF8433754dcBe863275AC6Dc5DB5` | 2276 |
| MockRouter | `0x68A1Ad5FB46c3Eb804F3375Cba702d806E1890B6` | 1961 |

Wiring and role reads at the pinned block:

| Read | Result | Meaning |
|---|---|---|
| `Guardian.owner()` | `0xe4f24B16CFF9171f555E4643262991023b5C0279` | protocol owner |
| `Tranches.treasury()` | `0xe4f24B16…C0279` | same address |
| `SimVenue.owner()` | `0xe4f24B16…C0279` | same address |
| owner codesize / `VERSION()` | 171 / "1.4.1" | **Safe v1.4.1 proxy** |
| `getThreshold()` / `getOwners()` | 2 / `[0x56d7fA40e3Aa6459C7c37AA517eaF6b75F702085, 0x8d025a78Af6ad079c4BC6c293Dd0505840a9211d, 0xbFFA06ec49874C744F45E36f4Db788a90B9f130C]` | 2-of-3 |
| `Guardian.paused()` | false | not paused |
| `SimVenue.isSimulated()` | true | venue is simulated |
| `EngineLite.router()` | MockRouter `0x68A1…90B6` | spot leg is mock, not Puddle |
| `BlitzVault.asset()` | DemoUSD `0x959E…9495` | vault asset is dUSD |
| `DemoUSD.decimals()` | 6 | |

## Drift and open items found this session (2026-09-23)

1. **README.md, FACTS.md, and docs/security/powers.md describe the superseded
   deployment** (`0x66B5…`/`0xdb46…`, block 57918591, Safe `0x85Fe…`). The live
   deployment is the one above. Doc updates should follow the in-flight
   `harden/p0-testnet` work, not race it.
2. **New Safe signer-key independence unverified.** The previous Safe's three
   signer keys were generated on one machine (README). Whether the new Safe's
   signers (`0x56d7…`, `0x8d02…`, `0xbFFA…`) are independently controlled is
   not evidenced anywhere. Owner: Kunal.
3. **Sourcify verification of the eleven current addresses not yet re-run**
   this session. The uncommitted `app/lib/verification.ts` asserts
   all-verified but must be regenerated via `pnpm verify:manifest`, not
   hand-edited (its own header says so).
4. **OPS.md §0 leaked Railway/Vercel token rotation is not evidenced** in the
   repo. The Railway token could read `KEEPER_PK`. Owner: Kunal.
5. **Keeper and public API share one process/env** (vessel-service holds
   `KEEPER_PK` beside public endpoints) — violates the spec §5 boundary
   "public data cannot sign"; split scheduled (docs/ARCHITECTURE.md).

## Testnet venue facts recorded on unmerged branches (not re-verified)

Recorded on `cursor/perpl-venue-bf3b` / `cursor/hull-series-gate-bf3b`
(2026-09-06/07). **UNVERIFIED here**; testnet-only — never mainnet defaults.

| Claim | Value | Source |
|---|---|---|
| Perpl testnet Exchange (proxy) | `0x1964C32f0bE608E7D29302AFF5E61268E72080cc` → impl `0x5dce9e6a404b1971aec34a30212337717a7232d1` | perpl-venue `docs/ADDRESSES.md` |
| Perpl testnet MON market | ID 64, `priceDecimals=5`, `lotDecimals=0` | `PerplPositionReader.sol` NatSpec |
| Perpl testnet collateral | AUSD `0xa9012a055bd4e0edff8ce09f960291c09d5322dc` | perpl-venue `docs/ADDRESSES.md` |
| Kuru testnet MON-USDC book | `bestAsk = 0` (empty) at block 60533271 | hull-series-gate `docs/SERIES-001.md` |
| Vessel Perpl account | none — `PERPL_ACCOUNT_ID <pending>`; the branch design has a keeper EOA own it (contradicts D13) | perpl-venue `docs/ADDRESSES.md` |

## Unresolved dependency register (spec §4 G01–G08, route gates G09–G10)

Owners are **proposed** per spec §25 and unconfirmed by the named people.

| ID | Dependency | Evidence required | Proposed owner | Status |
|---|---|---|---|---|
| G01 | Contract-owned Perpl account, constrained recovery | Demonstrated account control, revocation, destination limits | Daksh | OPEN — blocks mainnet beta |
| G02 | MON market metadata + executable depth (both venues) | Pinned ABIs, lot/precision, measured depth over time | Daksh | OPEN |
| G03 | Onchain MON/USD, USDC/USD, AUSD/USD valuation inputs | Approved feed IDs with freshness/deviation bounds | Daksh | OPEN — no oracle identified |
| G04 | USDC/AUSD conversion + withdrawal limits | Atomic two-leg route with aggregate output floor | Daksh | OPEN |
| G05 | Independent security reviewer | Engagement, scope, findings | Kunal | OPEN — blocks external deposits (D14) |
| G06 | Beta participant eligibility + offering terms | Counsel review, consent version | Kunal | OPEN — blocks invitations |
| G07 | Two-person operating coverage | Named primary/backup with availability | Kunal + Daksh | OPEN |
| G08 | Current repository status and deployed artifacts | This file + [INVENTORY.md](INVENTORY.md) + docs/sessions/01.md | Session 1 | **REOPENED 2026-09-30** — the 09-23 close did not cover the 13 unmerged `cursor/*` branches (Kuru router, Perpl reader/venue, Perpl keeper, oracles, caps, Envio). Now inventoried with reproduced test counts; closes when the drift items below are fixed in README/FACTS/powers.md and the eleven live addresses are re-verified on Sourcify. |
| G09 | Provider route qualification (D30) | Route record: source/destination tokens and decimals, provider contracts and versions, finality, size and fee bounds, recovery path, testnet delivery + refund receipts | Daksh | OPEN — no provider selected; Epoch is a candidate whose published network list does not establish Monad support (HANDBOOK_v4 ch. 6) |
| G10 | Beneficiary authentication and recovery (D30) | EIP-712 binding verified on arrival (ERC-1271 for contract wallets), observed-amount crediting, recovery on Monad with the quote service offline | Daksh | OPEN — no adapter exists |

## Source register

External sources S1–S12 are listed in docs/spec/VESSEL_V1.md §28 (checked
2026-09-22 by the blueprint author). Chain evidence above is this repo's own,
gathered 2026-09-23. Web-source rechecks (Kuru router vs market semantics,
Perpl API key scopes, market IDs) remain open under G01–G04.
