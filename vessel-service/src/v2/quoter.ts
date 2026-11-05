import { encodeFunctionData, erc20Abi, parseAbi, toFunctionSelector, type Address, type Hex } from "viem";
import type { Allowed, PlannedAction } from "./keeper.ts";

/**
 * Testnet market maker for Vessel's own Kuru markets (ADR-009). Nothing arbitrages these
 * markets against Perpl on testnet, so without this loop the quotes stay where they were placed,
 * and once MON moves past the engine's 30 bps band the engine (correctly) refuses every trade.
 *
 * A PURE decision from observed state to at most one transaction, signed by the seeder (never
 * the keeper) through the same durable journal. It only ever posts resting orders (post-only):
 * the seeder never takes liquidity, and it never moves funds anywhere but Kuru's margin account.
 */
export const QUOTER_POLICY_VERSION = "v2-quoter-1";

export const kuruBookAbi = parseAbi([
  "function batchUpdate(uint32[] buyPrices, uint96[] buySizes, uint32[] sellPrices, uint96[] sellSizes, uint40[] orderIdsToCancel, bool postOnly)",
  "function batchCancelFlipOrders(uint40[] orderIds)",
  "function s_orderIdCounter() view returns (uint40)",
  "function s_orders(uint40) view returns (address owner, uint96 size, uint40 prev, uint40 next, uint40 flippedId, uint32 price, uint32 flippedPrice, bool isBuy)",
  "function getMarketParams() view returns (uint32, uint96, address, uint256, address, uint256, uint32, uint96, uint96, uint256, uint256)",
]);
export const kuruMarginAbi = parseAbi([
  "function deposit(address user, address token, uint256 amount) payable",
  "function getBalance(address user, address token) view returns (uint256)",
]);

const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const BPS = 10_000n;
const E18 = 10n ** 18n;

/** `tokens`: the quote tokens, plus the spot token when it is an ERC-20 (vMON). */
export function quoterAllowlist(markets: readonly Address[], margin: Address, quoteTokens: readonly Address[]): Allowed[] {
  return [
    ...markets.flatMap((m) => [
      { target: m, selector: toFunctionSelector("batchUpdate(uint32[],uint96[],uint32[],uint96[],uint40[],bool)"), action: "batchUpdate" },
      { target: m, selector: toFunctionSelector("batchCancelFlipOrders(uint40[])"), action: "batchCancelFlipOrders" },
    ]),
    { target: margin, selector: toFunctionSelector("deposit(address,address,uint256)"), action: "marginDeposit", payable: true },
    ...quoteTokens.map((t) => ({ target: t, selector: toFunctionSelector("approve(address,uint256)"), action: "approve" })),
  ];
}

export interface LiveOrder {
  id: bigint;
  price: bigint; // market price units
  size: bigint; // base units scaled by sizePrecision
  isBuy: boolean;
  flip: boolean;
  /** the linked order a filled flip order spawned (0 if none) */
  flippedId: bigint;
}

export interface QuoteMarket {
  book: Address;
  quoteToken: Address;
  pricePrecision: bigint;
  sizePrecision: bigint;
  tick: bigint;
  minSize: bigint;
  live: LiveOrder[];
  /** seeder's free quote balance in Kuru's margin account, and in its wallet; allowance to the margin account */
  marginQuote: bigint;
  walletQuote: bigint;
  allowance: bigint;
}

export interface QuoteObserved {
  now: bigint;
  /** Perpl MON mark in the markets' price units (USD × pricePrecision) and its timestamp */
  mark: bigint;
  markAt: bigint;
  margin: Address;
  seeder: Address;
  /** the markets' base asset: address(0) is native MON; otherwise the vMON test token (ADR-010) */
  spot: Address;
  /** seeder's free spot in Kuru's margin account (wei), shared by both markets, in its wallet,
   *  and (token spot only) its allowance to the margin account */
  marginMon: bigint;
  walletMon: bigint;
  spotAllowance: bigint;
  markets: QuoteMarket[];
  /** when this seeder last re-quoted each book (from the journal); 0 if never */
  lastQuotedAt: Record<string, bigint>;
}

export interface QuoteConfig {
  /** distance of each level from the mark, bps; the share of capital each level gets, bps */
  levelsBps: readonly bigint[];
  levelShareBps: readonly bigint[];
  /** re-quote when our mid is this far from the mark */
  recenterBps: bigint;
  /** at most one re-quote per book in this many seconds, unless the mid is `urgentBps` off
   *  (each re-quote costs ~0.09 MON on Monad, which bills the gas limit) */
  minRequoteGapSec: bigint;
  urgentBps: bigint;
  /** re-quote anyway after this long, or when more than this share of a book's capital sits unposted
   *  in the margin account (fills move capital to the other side, where it waits to be re-posted) */
  maxAgeSec: bigint;
  idleBps: bigint;
  /** MON kept in the wallet for gas; smallest deposits worth a transaction */
  gasReserveMon: bigint;
  minDepositQuote: bigint;
  minDepositMon: bigint;
  /** do nothing when the mark is older than this (the engine would refuse to trade anyway) */
  markMaxAgeSec: bigint;
}

export const defaultQuoteConfig: QuoteConfig = {
  levelsBps: [5n, 25n],
  levelShareBps: [4_000n, 6_000n],
  recenterBps: 15n,
  minRequoteGapSec: 300n,
  urgentBps: 25n,
  maxAgeSec: 6n * 3600n,
  idleBps: 2_500n,
  gasReserveMon: 2n * E18,
  minDepositQuote: 1_000_000n,
  minDepositMon: 10n * E18,
  markMaxAgeSec: 120n,
};

const roundToTick = (price: bigint, tick: bigint, up: boolean) => {
  const r = price % tick;
  return r === 0n ? price : up ? price - r + tick : price - r;
};

/** Order prices for one side: each level away from the mark, rounded outward to the tick. */
export function levelPrices(mark: bigint, tick: bigint, levelsBps: readonly bigint[], isBuy: boolean): bigint[] {
  return levelsBps.map((bps) =>
    isBuy ? roundToTick((mark * (BPS - bps)) / BPS, tick, false) : roundToTick((mark * (BPS + bps)) / BPS, tick, true),
  );
}

/** Quote value (token units) of `size` base units at `price`. */
const quoteOf = (size: bigint, price: bigint, m: QuoteMarket) => (size * price * 1_000_000n) / m.sizePrecision / m.pricePrecision;
/** Base size for `quote` token units at `price`. */
const sizeForQuote = (quote: bigint, price: bigint, m: QuoteMarket) => (quote * m.sizePrecision * m.pricePrecision) / price / 1_000_000n;
const monOf = (size: bigint, m: QuoteMarket) => (size * E18) / m.sizePrecision;
const sizeForMon = (wei: bigint, m: QuoteMarket) => (wei * m.sizePrecision) / E18;

export function decideQuotes(o: QuoteObserved, cfg: QuoteConfig): PlannedAction | null {
  const act = (target: Address, data: Hex, action: string, id: string, inputs: object): PlannedAction => ({
    clientRequestId: `quote:${id}:${o.now / 15n}`,
    action,
    target,
    calldata: data,
    inputs: { ...inputs, policyVersion: QUOTER_POLICY_VERSION },
  });

  // 1. Move idle wallet funds into Kuru's margin account (approval first), keeping MON for gas.
  for (const m of o.markets) {
    if (m.walletQuote >= cfg.minDepositQuote) {
      if (m.allowance < m.walletQuote) {
        return act(m.quoteToken, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [o.margin, 2n ** 256n - 1n] }), "approve", `approve:${m.quoteToken}`, {});
      }
      return act(
        o.margin,
        encodeFunctionData({ abi: kuruMarginAbi, functionName: "deposit", args: [o.seeder, m.quoteToken, m.walletQuote] }),
        "marginDeposit",
        `deposit:${m.quoteToken}`,
        { amount: m.walletQuote.toString() },
      );
    }
  }
  const nativeSpot = o.spot.toLowerCase() === NATIVE;
  // Native MON keeps a gas reserve in the wallet; a token spot needs none (gas is native MON).
  const spare = nativeSpot ? (o.walletMon > cfg.gasReserveMon ? o.walletMon - cfg.gasReserveMon : 0n) : o.walletMon;
  if (spare >= cfg.minDepositMon) {
    if (!nativeSpot && o.spotAllowance < spare) {
      return act(o.spot, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [o.margin, 2n ** 256n - 1n] }), "approve", `approve:${o.spot}`, {});
    }
    const deposit = act(o.margin, encodeFunctionData({ abi: kuruMarginAbi, functionName: "deposit", args: [o.seeder, o.spot, spare] }), "marginDeposit", "deposit:spot", { amount: spare.toString() });
    return nativeSpot ? { ...deposit, value: spare } : deposit;
  }

  if (o.mark === 0n || o.markAt + cfg.markMaxAgeSec < o.now) return null;

  // 2. Flip orders from the seeding script are cancelled first; this loop posts plain resting orders.
  // A partly filled flip order is linked to the order it spawned, and cancelling one cancels both
  // (fork probe 2026-10-08); naming both makes Kuru revert the whole batch, so name one per pair.
  for (const m of o.markets) {
    const flips: bigint[] = [];
    for (const x of m.live.filter((y) => y.flip).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!flips.includes(x.flippedId)) flips.push(x.id);
    }
    if (flips.length) {
      return act(m.book, encodeFunctionData({ abi: kuruBookAbi, functionName: "batchCancelFlipOrders", args: [flips.map(Number)] }), "batchCancelFlipOrders", `cancelflip:${m.book}`, { ids: flips.map(String) });
    }
  }

  // 3. Re-quote the book that is furthest off: cancel everything we have there and post fresh levels.
  // MON is one balance in the margin account for both markets, so each book gets half of the total.
  const lockedMon = (m: QuoteMarket) => m.live.filter((x) => !x.isBuy).reduce((a, x) => a + monOf(x.size, m), 0n);
  const totalMon = o.marginMon + o.markets.reduce((a, m) => a + lockedMon(m), 0n);
  for (const m of o.markets) {
    const bids = m.live.filter((x) => x.isBuy);
    const asks = m.live.filter((x) => !x.isBuy);
    const quoteCapital = m.marginQuote + bids.reduce((a, x) => a + quoteOf(x.size, x.price, m), 0n);
    const monCapital = (totalMon * 1n) / BigInt(o.markets.length);
    const monAvailable = o.marginMon + lockedMon(m);
    const monForBook = monCapital < monAvailable ? monCapital : monAvailable;
    if (quoteCapital === 0n && monForBook === 0n) continue;

    const bestBid = bids.reduce((a, x) => (x.price > a ? x.price : a), 0n);
    const bestAsk = asks.reduce((a, x) => (a === 0n || x.price < a ? x.price : a), 0n);
    const ourMid = bestBid && bestAsk ? (bestBid + bestAsk) / 2n : 0n;
    const off = ourMid ? ((ourMid > o.mark ? ourMid - o.mark : o.mark - ourMid) * BPS) / o.mark : BPS;
    const idleQuote = m.marginQuote;
    const idleMon = monForBook > lockedMon(m) ? monForBook - lockedMon(m) : 0n;
    const depleted = idleQuote * BPS > quoteCapital * cfg.idleBps || idleMon * BPS > monForBook * cfg.idleBps;
    const since = o.now - (o.lastQuotedAt[m.book.toLowerCase()] ?? 0n);
    const stale = since > cfg.maxAgeSec;
    if (off <= cfg.recenterBps && !depleted && !stale) continue;
    // Gas guard: a book that was just quoted waits, unless the engine is about to be priced out.
    if (since < cfg.minRequoteGapSec && off <= cfg.urgentBps) continue;

    const buyPrices = levelPrices(o.mark, m.tick, cfg.levelsBps, true);
    const sellPrices = levelPrices(o.mark, m.tick, cfg.levelsBps, false);
    const buySizes = buyPrices.map((p, i) => sizeForQuote((quoteCapital * cfg.levelShareBps[i]!) / BPS, p, m));
    const sellSizes = sellPrices.map((_, i) => sizeForMon((monForBook * cfg.levelShareBps[i]!) / BPS, m));
    const keep = (sizes: bigint[], prices: bigint[]) => prices.map((p, i) => [p, sizes[i]!] as const).filter(([, s]) => s >= m.minSize);
    const buys = keep(buySizes, buyPrices);
    const sells = keep(sellSizes, sellPrices);
    const cancel = m.live.map((x) => x.id);
    if (!buys.length && !sells.length && !cancel.length) continue;
    return act(
      m.book,
      encodeFunctionData({
        abi: kuruBookAbi,
        functionName: "batchUpdate",
        args: [
          buys.map(([p]) => Number(p)),
          buys.map(([, s]) => s),
          sells.map(([p]) => Number(p)),
          sells.map(([, s]) => s),
          cancel.map(Number),
          true,
        ],
      }),
      "batchUpdate",
      `requote:${m.book}`,
      {
        why: !ourMid ? "no live quotes" : off > cfg.recenterBps ? `mid ${off} bps from mark` : depleted ? "re-post filled capital" : "refresh",
        mark: o.mark.toString(),
        bids: buys.map(([p, s]) => `${s}@${p}`),
        asks: sells.map(([p, s]) => `${s}@${p}`),
        cancelled: cancel.map(String),
      },
    );
  }
  return null;
}
