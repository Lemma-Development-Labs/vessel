# Hull series-001 — GATE-0 (market not launched)

**Status:** blocked. Do not deploy `HullSeries`, do not create a Kuru market, do not seed two-sided quotes.

**HARD GATE (Metropolis week of 29 Sep–5 Oct):** both of the following must appear as **real transaction hashes** in [`ADDRESSES.md`](./ADDRESSES.md) before any series-001 work ships:

| Gate key | Current state (this repo) | Meaning |
|---|---|---|
| `TX_KURU_SPOT` | `<pending>` — empty MON-USDC book / no `DEPLOYER_PK` | Spot path still MockRouter |
| `TX_PERPL_SHORT` | `<pending>` — alias for live `PERPL_KEEPER_ORDER` (also `<pending>`, no `PERPL_API_KEY`) | Engine still hedges via **SimVenue**, not a live Perpl short |

A Hull token whose short is SimVenue is a market on a fiction. Listing it would be the single most damaging thing we could do to a verifiability brand. **This document exists so the stop is explicit.**

Related product page stub (terms only, no market): [`docs/series/001.md`](./series/001.md).

---

## Why this fits the bounty (when the gate opens)

Bounty: *Bring New Assets and Markets to Kuru — $5,000. "A new class of tradable markets on Kuru's spot order book, including the infrastructure to make them viable."*

A dated senior tranche with a published coupon, published maturity, an on-chain hedge behind it, and a two-sided quote is a **new asset class on a spot CLOB** — not another memecoin pair. The infrastructure half is Ballast subordination + ParamCreator-derived tick/lot + a Ballast-seeded market maker that pulls when the engine halts.

---

## Fact-check — Kuru market creation (quoted 2026-09-07)

Primary sources:

- [Deploy a market (SDK)](https://docs.kuru.io/sdk/deploy-market)
- [Router](https://docs.kuru.io/contracts/Router)

### Router — `deployProxy`

From Kuru Router docs:

```solidity
function deployProxy(
    IOrderBook.OrderBookType _type,
    address _baseAssetAddress,
    address _quoteAssetAddress,
    uint96 _sizePrecision,
    uint32 _pricePrecision,
    uint32 _tickSize,
    uint96 _minSize,
    uint96 _maxSize,
    uint256 _takerFeeBps,
    uint256 _makerFeeBps,
    uint96 _kuruAmmSpread
) public returns (address proxy)
```

`OrderBookType`: `NO_NATIVE` · `NATIVE_IN_BASE` · `NATIVE_IN_QUOTE` (SDK numeric: `0` / `1` / `2`). Create2-deterministic OrderBook + KuruAMMVault; market registered in `verifiedMarket`. Hull / Kuru USDC is `NO_NATIVE` (`0`). SDK deploy examples use `address(0)` for the native side when applicable.

### SDK — `ParamCreator` (do not guess tick/lot)

Docs warn: *Using inappropriate parameters for the market can lead to users not being able to place limit orders.* Derive via `calculatePrecisions`, then double-check before deploy.

Current documented signature ([deploy-market](https://docs.kuru.io/sdk/deploy-market)):

```ts
const paramCreator = new ParamCreator();
// TICK_IN_BPS: docs recommend smaller ticks for tokens that trade in a short range
// (a dated bill near par) and larger ticks for memecoins.
const precisions = paramCreator.calculatePrecisions(
  currentQuote, // e.g. 1 face ≈ 1 USDC near par → quote=1, base=1
  currentBase,
  maxPrice,     // maximum expected price
  minSize,      // min limit order size in base
  tickInBps     // e.g. 10 BPS for a near-par bill — not dollar ticks
);

const marketAddress = await paramCreator.deployMarket(
  signer,
  routerAddress,
  0,                 // NO_NATIVE
  baseAssetAddress,  // HullSeries001
  quoteAssetAddress, // Kuru testnet USDC 0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570
  precisions.sizePrecision,
  precisions.pricePrecision,
  precisions.tickSize,
  precisions.minSize,
  precisions.maxSize,
  30,                // takerFeeBps
  10,                // makerFeeBps
  kuruAmmSpread      // docs: 30 stable / 100 volatile; multiple of 10; min 10 max 500
);
```

**Dated bill near par:** tick must express **basis points of face**, not dollars. Wrong tick sizing makes the book unusable — first thing a CLOB team checks.

**Quote asset for series-001 (when live):** Kuru testnet USDC `0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570` — **not** Circle USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3` (no Kuru book; not the vault asset). Three-stable rule: see [`docs/risk.md`](./risk.md) / [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Planned product (not built while gate is closed)

### `HullSeries` ERC-20 (one contract per series)

- OpenZeppelin ERC20 + ERC20Permit.
- Immutables: `maturity`, `couponBps`, `underlyingVault`, `seriesId`.
- `redeem()` reverts before maturity; transfers always free.
- **Subordination on mint:** `require(hullOutstanding + amount <= ballastPosted * maxLeverage, InsufficientBallast())` — revert, not warning.
- **Close ERC-4626 bypass:** public `deposit`/`mint` must not route around the tranche floor (gate behind tranche logic or make 4626 surface internal-only). Test must prove the hole is closed.

### Coupon (not a marketing number)

```
couponBps = trailingObservedNetFunding − publishedHaircut − protocolTake
```

Must be computed from indexer / observed funding with **from/to blocks stated** in this file. If we cannot source it from observed funding → `[GATE-0]` and the series does not launch.

### Market + viability infrastructure

- Script: `script/createHullMarket.ts` — base HullSeries001, quote Kuru USDC, ParamCreator tick/lot, address → `ADDRESSES.md`.
- Keeper: `keeper/src/hullMarketMaker.ts` — quotes around `PV = face / (1 + coupon × timeToMaturity)`, widens as maturity approaches / hedge deviation grows; inventory from a **Ballast-seeded** wallet (page must say so); **pull quotes when the engine halts**.
- Transparency: Hull tile — last, bid/ask, implied YTM vs published coupon; if market < par, show coupon was optimistic.

### Tests (when gate opens)

```
test_RedeemRevertsBeforeMaturity
test_TransferAlwaysAllowed
test_MintRevertsWhenBallastFloorInsufficient
test_ERC4626PublicEntrypointCannotBypassFloor
test_CouponDerivedFromIndexerData_notConstant
testFork_MarketCreatedWithCorrectTickLot
testFork_TwoSidedClipExecutes
test_QuotesPulledWhenEngineHalted
```

### Ship checklist (when gate opens)

1. Deploy + verify HullSeries001.
2. Create market; record address.
3. First two-sided clip: buy + sell from different addresses; both hashes in `ADDRESSES.md`.
4. This doc live on docs.vessel.wtf: terms, coupon derivation with blocks, waterfall, quoting policy, risks.
5. Post: dated senior claim on a spot CLOB + hedge behind it — market link, hedge tx, verification recipe.

---

## GATE-0 mentor question (ask Vaibhav / Kuru — week 1, not this week)

Does a **testnet** market qualify for the $5k “new assets and markets” bounty, or must it be **mainnet**? If mainnet-only, a testnet listing is a demo and the $5k comes off the sheet. Ask before spending a full build week after the venue gate opens.

---

## Review bar (this PR)

| Check | Result |
|---|---|
| Both venue hashes present before market work started? | **No** — gate holds; no `HullSeries` / market / MM shipped |
| Coupon traceable block-by-block? | N/A — series not launched |
| Mint reverts on insufficient Ballast (test)? | N/A — contract not shipped |
| 4626 bypass closed (test)? | N/A — not shipped |
| Page says quotes are ours? | N/A — no live quotes |

When `TX_KURU_SPOT` and `TX_PERPL_SHORT` (or the live `PERPL_KEEPER_ORDER` hash recorded under that alias) are both real, reopen this doc and execute the build section.
