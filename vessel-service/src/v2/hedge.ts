import { encodeFunctionData, parseAbi, toFunctionSelector, type Address } from "viem";
import type { Allowed, PlannedAction } from "./keeper.ts";

/**
 * Hedge policy for HedgedEngine: a PURE function from observed engine state to at most one
 * engine action. The engine enforces every bound on chain (slice cap, hedge gap, price bands,
 * conversion floor, stale prices, pause); this policy only chooses the next step and always
 * passes the tightest minimum the engine accepts, so a bad decision reverts instead of losing.
 *
 * Shape of the book inside the engine: spot MON ≈ short MON, and Perpl margin ≈ spot value
 * plus a buffer (leverage 1×: the whole short notional is posted). Engine USDC is spent down
 * to that split; the controller keeps the book's idle buffer in custody.
 */
export const HEDGE_POLICY_VERSION = "v2-hedge-policy-1";

export const engineWriteAbi = parseAbi([
  "function buySpot(uint256 usdcIn, uint256 minMonOut)",
  "function sellSpot(uint256 monIn, uint256 minUsdcOut)",
  "function openShort(uint256 lots, uint256 minPricePNS)",
  "function closeShort(uint256 lots, uint256 maxPricePNS)",
  "function depositMargin(uint256 amount)",
  "function withdrawMargin(uint256 amount)",
  "function convertToMargin(uint256 usdcIn, uint256 minAusdOut)",
  "function convertToCash(uint256 ausdIn, uint256 minUsdcOut)",
]);

const ACTIONS = [
  "buySpot(uint256,uint256)",
  "sellSpot(uint256,uint256)",
  "openShort(uint256,uint256)",
  "closeShort(uint256,uint256)",
  "depositMargin(uint256)",
  "withdrawMargin(uint256)",
  "convertToMargin(uint256,uint256)",
  "convertToCash(uint256,uint256)",
] as const;

export function engineAllowlist(engine: Address): Allowed[] {
  return ACTIONS.map((sig) => ({ target: engine, selector: toFunctionSelector(sig), action: sig.split("(")[0]! }));
}

/** Mirrors HedgedEngine constants; the contract is the authority. */
const BPS = 10_000n;
const SPOT_SLIPPAGE_BPS = 30n;
const CONVERSION_BPS = 20n;
const PERP_PRICE_BAND_BPS = 30n;
const PRICE_MAX_AGE = 60n;
const E18 = 10n ** 18n;
const E30 = 10n ** 30n;

export interface HedgeObserved {
  now: bigint;
  /** valuation: USDC per MON and per AUSD (1e18), observed at */
  px: bigint;
  fx: bigint;
  priceAt: bigint;
  riskPaused: boolean;
  /** engine ledger and venue state */
  value: bigint;
  sliceCap: bigint;
  usdcCash: bigint;
  ausdCash: bigint;
  monQty: bigint;
  shortLots: bigint;
  perplAccountId: bigint;
  /** free (unlocked) balance in the engine's Perpl account, AUSD units */
  perplFree: bigint;
  /** free + position deposit + marked PnL, AUSD units */
  perplEquity: bigint;
  minAccountOpen: bigint;
  /** engine immutables */
  spotSizePrecision: bigint;
  perpPriceScale: bigint;
  perpLotScale: bigint;
  leverageHdths: bigint;
  /** USDC the controller wants back that the engine does not hold as cash (0 = hedge normally) */
  cashShortfall: bigint;
}

export interface HedgeConfig {
  /** smallest move worth a transaction, USDC units */
  minMove: bigint;
  /** largest single USDC⇄AUSD conversion, USDC units */
  conversionChunk: bigint;
  /** margin posted above spot value, bps (fees, funding, PnL drift) */
  marginBufferBps: bigint;
  /** fraction of the on-chain slice cap to use, bps (prices move between read and send) */
  sliceUseBps: bigint;
}

export const defaultHedgeConfig: HedgeConfig = {
  minMove: 1_000_000n,
  conversionChunk: 500_000_000n,
  marginBufferBps: 300n,
  sliceUseBps: 9_500n,
};

const minB = (a: bigint, b: bigint) => (a < b ? a : b);

/** Floors exactly as HedgedEngine computes them. */
export const floors = {
  buySpot: (usdcIn: bigint, px: bigint) => ((usdcIn * E30) / px) * (BPS - SPOT_SLIPPAGE_BPS) / BPS,
  sellSpot: (mon: bigint, px: bigint, sizePrecision: bigint) => {
    const exact = ((mon * sizePrecision) / E18) * E18 / sizePrecision;
    return ((exact * px) / E30) * (BPS - SPOT_SLIPPAGE_BPS) / BPS;
  },
  openShort: (px: bigint, priceScale: bigint) => ((px * priceScale) / E18) * (BPS - PERP_PRICE_BAND_BPS) / BPS,
  closeShort: (px: bigint, priceScale: bigint) => ((px * priceScale) / E18) * (BPS + PERP_PRICE_BAND_BPS) / BPS,
  toMargin: (usdcIn: bigint, fx: bigint) => ((usdcIn * E18) / fx) * (BPS - CONVERSION_BPS) / BPS,
  toCash: (ausdIn: bigint, fx: bigint) => ((ausdIn * fx) / E18) * (BPS - CONVERSION_BPS) / BPS,
};

export function decideHedge(o: HedgeObserved, cfg: HedgeConfig, engine: Address): PlannedAction | null {
  if (o.px === 0n || o.fx === 0n || o.priceAt + PRICE_MAX_AGE < o.now) return null; // engine would refuse
  const slice = (o.sliceCap * cfg.sliceUseBps) / BPS;
  if (slice < cfg.minMove) return null;

  const monPerLot = E18 / o.perpLotScale;
  const shortMon = o.shortLots * monPerLot;
  const usdcOf = (mon: bigint) => (mon * o.px) / E30;
  const usdcOfAusd = (ausd: bigint) => (ausd * o.fx) / E18;
  const monOf = (usdc: bigint) => (usdc * E30) / o.px;
  const lotsOf = (usdc: bigint) => monOf(usdc) / monPerLot;
  const sliceMon = monOf(slice);
  const sliceLots = lotsOf(slice);
  const minMon = monOf(cfg.minMove);

  const act = (fn: (typeof engineWriteAbi)[number]["name"], args: readonly bigint[], why: string): PlannedAction => ({
    clientRequestId: `hedge:${fn}:${o.now / 30n}`,
    action: fn,
    target: engine,
    calldata: encodeFunctionData({ abi: engineWriteAbi, functionName: fn, args } as never),
    inputs: { args: args.map(String), why, policyVersion: HEDGE_POLICY_VERSION },
  });
  const sell = (mon: bigint, why: string) =>
    act("sellSpot", [mon, floors.sellSpot(mon, o.px, o.spotSizePrecision)], why);
  const close = (lots: bigint, why: string) =>
    act("closeShort", [lots, floors.closeShort(o.px, o.perpPriceScale)], why);
  const toCash = (ausd: bigint, why: string) => act("convertToCash", [ausd, floors.toCash(ausd, o.fx)], why);

  // 1. The book needs cash back: unwind in slices, keeping spot and short within one slice.
  if (o.cashShortfall > 0n) {
    if (usdcOfAusd(o.ausdCash) >= cfg.minMove) return toCash(minB(o.ausdCash, cfg.conversionChunk), "unwind: AUSD to cash");
    if (o.monQty > shortMon + minMon) return sell(minB(o.monQty - shortMon, sliceMon), "unwind: spot above short");
    if (o.shortLots > 0n) return close(minB(o.shortLots, sliceLots), "unwind: close a short slice");
    if (o.monQty > minMon) return sell(minB(o.monQty, sliceMon), "unwind: sell spot");
    if (usdcOfAusd(o.perplFree) >= cfg.minMove) return act("withdrawMargin", [o.perplFree], "unwind: withdraw margin");
    return null;
  }

  // 2. Keep the hedge matched. Shorting narrows the gap unless new risk is paused; then sell spot.
  if (o.shortLots * monPerLot > o.monQty + monPerLot) {
    return close(minB((shortMon - o.monQty) / monPerLot, sliceLots), "rebalance: short above spot");
  }
  const gapLots = (o.monQty - minB(o.monQty, shortMon)) / monPerLot;
  if (gapLots > 0n && usdcOf(gapLots * monPerLot) >= cfg.minMove) {
    if (o.riskPaused) return sell(minB(o.monQty - shortMon, sliceMon), "rebalance: paused, sell unhedged spot");
    const lots = minB(gapLots, sliceLots);
    const marginNeeded = (usdcOf(lots * monPerLot) * 100n * (BPS + cfg.marginBufferBps)) / o.leverageHdths / BPS;
    if (o.perplAccountId > 0n && usdcOfAusd(o.perplFree) >= marginNeeded) {
      return act("openShort", [lots, floors.openShort(o.px, o.perpPriceScale)], "hedge: short the new spot");
    }
    // Not enough free margin: fall through to the margin step.
  }

  // 3. Margin toward target: spot value × (1 + buffer). Spot target S = V / (2 + buffer).
  // Perpl keeps an account only above its minimum, so margin never targets below it (plus the
  // conversion budget); spot gets what is left. A small book therefore hedges a small spot leg
  // instead of opening the account and then trying to withdraw below the venue's floor.
  const minMargin = (((o.minAccountOpen * o.fx) / E18) * (BPS + 2n * CONVERSION_BPS)) / BPS;
  const halfSplitSpot = (o.value * BPS) / (2n * BPS + cfg.marginBufferBps);
  const marginTarget = o.value - halfSplitSpot > minMargin ? o.value - halfSplitSpot : minMargin;
  const spotTarget = o.value > marginTarget ? o.value - marginTarget : 0n;
  const marginNow = ((o.perplEquity + o.ausdCash) * o.fx) / E18;
  const opening = o.perplAccountId === 0n;
  const marginExcess = marginNow > marginTarget + 2n * cfg.minMove + slice;
  // AUSD sitting in the engine is margin in transit: post it, unless margin is over target.
  if (!marginExcess && usdcOfAusd(o.ausdCash) >= cfg.minMove && (!opening || o.ausdCash >= o.minAccountOpen)) {
    return act("depositMargin", [o.ausdCash], opening ? "margin: open the engine's Perpl account" : "margin: post AUSD");
  }
  if (marginNow + cfg.minMove < marginTarget || opening) {
    let usdcIn = minB(minB(marginTarget > marginNow ? marginTarget - marginNow : 0n, o.usdcCash), cfg.conversionChunk);
    if (opening) {
      // The account opens only with the venue minimum; convert enough to clear it after fees.
      const openUsdc = ((o.minAccountOpen - o.ausdCash) * o.fx * (BPS + 2n * CONVERSION_BPS)) / E18 / BPS;
      if (usdcIn < openUsdc) usdcIn = openUsdc <= o.usdcCash ? openUsdc : 0n;
    }
    if (usdcIn >= cfg.minMove) return act("convertToMargin", [usdcIn, floors.toMargin(usdcIn, o.fx)], "margin: USDC to AUSD");
    if (opening) return null; // nothing to hedge with until the account exists
  } else if (marginExcess) {
    const excess = marginNow - marginTarget;
    if (usdcOfAusd(o.ausdCash) >= cfg.minMove) return toCash(minB(o.ausdCash, cfg.conversionChunk), "margin: excess AUSD to cash");
    // Never withdraw the account below Perpl's minimum.
    const aboveMin = o.perplEquity > o.minAccountOpen ? o.perplEquity - o.minAccountOpen : 0n;
    const free = minB(minB(o.perplFree, (excess * E18) / o.fx), aboveMin);
    if (usdcOfAusd(free) >= cfg.minMove) return act("withdrawMargin", [free], "margin: withdraw excess");
  }

  // 4. Spot toward target, one slice at a time; the next tick shorts it.
  const spotNow = usdcOf(o.monQty);
  // Perpl shorts whole lots, so up to a lot (worth less than minMove) can stay unhedged.
  const unhedged = usdcOf(o.monQty - minB(o.monQty, shortMon));
  if (!o.riskPaused && spotNow + cfg.minMove < spotTarget && unhedged < cfg.minMove) {
    // The engine caps the gap after the trade at one slice, so leave room for what is already unhedged.
    const usdcIn = minB(minB(slice - unhedged, spotTarget - spotNow), o.usdcCash);
    if (usdcIn >= cfg.minMove) return act("buySpot", [usdcIn, floors.buySpot(usdcIn, o.px)], "hedge: buy a spot slice");
  }
  if (spotNow > spotTarget + slice + cfg.minMove) {
    return sell(minB(spotNow - spotTarget, slice) * E30 / o.px, "rebalance: spot above target");
  }
  return null;
}
