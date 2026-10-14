import { decodeFunctionData, erc20Abi, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import {
  decideQuotes,
  defaultQuoteConfig,
  kuruBookAbi,
  kuruMarginAbi,
  levelPrices,
  quoterAllowlist,
  type QuoteMarket,
  type QuoteObserved,
} from "../src/v2/quoter.ts";

const USDC_BOOK = "0x00000000000000000000000000000000000000b1" as const;
const AUSD_BOOK = "0x00000000000000000000000000000000000000b2" as const;
const USDC = "0x00000000000000000000000000000000000000c1" as const;
const AUSD = "0x00000000000000000000000000000000000000c2" as const;
const MARGIN = "0x00000000000000000000000000000000000000d1" as const;
const SEEDER = "0x00000000000000000000000000000000000000e1" as const;
const E18 = 10n ** 18n;
const MARK = 2_900_000n; // $0.029 at pricePrecision 1e8
const cfg = defaultQuoteConfig;

const market = (book: `0x${string}`, quoteToken: `0x${string}`, over: Partial<QuoteMarket> = {}): QuoteMarket => ({
  book,
  quoteToken,
  pricePrecision: 100_000_000n,
  sizePrecision: 10_000_000_000n,
  tick: 100n,
  minSize: 10_000_000_000n,
  live: [],
  marginQuote: 2_000_000_000n,
  walletQuote: 0n,
  allowance: 2n ** 255n,
  ...over,
});

const base = (over: Partial<QuoteObserved> = {}): QuoteObserved => ({
  now: 1_800_000_000n,
  mark: MARK,
  markAt: 1_800_000_000n,
  margin: MARGIN,
  seeder: SEEDER,
  spot: "0x0000000000000000000000000000000000000000",
  marginMon: 100_000n * E18,
  walletMon: E18,
  spotAllowance: 0n,
  markets: [market(USDC_BOOK, USDC), market(AUSD_BOOK, AUSD)],
  lastQuotedAt: {},
  ...over,
});

const decodeBook = (data: string) => decodeFunctionData({ abi: kuruBookAbi, data: data as `0x${string}` });

/** What a fresh, centred quote on the USDC book looks like, as live orders. */
function liveFromFirstQuote(o: QuoteObserved): QuoteObserved {
  const p = decideQuotes(o, cfg)!;
  const d = decodeBook(p.calldata);
  const [bp, bs, sp, ss] = d.args as unknown as [number[], bigint[], number[], bigint[]];
  let id = 1n;
  const live = [
    ...bp.map((px, i) => ({ id: id++, price: BigInt(px), size: bs[i]!, isBuy: true, flip: false, flippedId: 0n })),
    ...sp.map((px, i) => ({ id: id++, price: BigInt(px), size: ss[i]!, isBuy: false, flip: false, flippedId: 0n })),
  ];
  // Posting moves the funds out of the free margin balance into the orders.
  const postedMon = ss.reduce((acc, x) => acc + (x * E18) / 10_000_000_000n, 0n);
  return {
    ...o,
    marginMon: o.marginMon - postedMon,
    markets: o.markets.map((m) => (m.book === p.target ? { ...m, live, marginQuote: 0n } : m)),
    lastQuotedAt: { ...o.lastQuotedAt, [p.target.toLowerCase()]: o.now },
  } as QuoteObserved;
}

describe("kuru quoter — decisions", () => {
  it("prices each level away from the mark and rounds outward to the tick", () => {
    expect(levelPrices(MARK, 100n, [5n, 25n], true)).toEqual([2_898_500n, 2_892_700n]);
    expect(levelPrices(MARK, 100n, [5n, 25n], false)).toEqual([2_901_500n, 2_907_300n]);
  });

  it("first quote: cancels nothing, posts two post-only levels each side from capital", () => {
    const p = decideQuotes(base(), cfg)!;
    expect(p.action).toBe("batchUpdate");
    expect(p.target).toBe(USDC_BOOK);
    const [bp, bs, sp, ss, cancel, postOnly] = decodeBook(p.calldata).args as unknown as [number[], bigint[], number[], bigint[], number[], boolean];
    expect(bp).toEqual([2_898_500, 2_892_700]);
    expect(sp).toEqual([2_901_500, 2_907_300]);
    expect(cancel).toEqual([]);
    expect(postOnly).toBe(true);
    // 40% / 60% of 2,000 USDC on the bid side; half of the 100,000 MON on this book's ask side.
    const quoteOf = (s: bigint, px: number) => (s * BigInt(px) * 1_000_000n) / 10_000_000_000n / 100_000_000n;
    expect(Number(quoteOf(bs[0]!, bp[0]!))).toBeCloseTo(800_000_000, -3);
    expect(Number(quoteOf(bs[1]!, bp[1]!))).toBeCloseTo(1_200_000_000, -3);
    expect((ss[0]! + ss[1]!) * E18 / 10_000_000_000n).toBe(50_000n * E18);
  });

  it("leaves a centred, full, recent quote alone", () => {
    const quoted = liveFromFirstQuote(base({ markets: [market(USDC_BOOK, USDC)] }));
    expect(decideQuotes(quoted, cfg)).toBeNull();
  });

  it("re-centres when the mark moves past the threshold, cancelling every live order", () => {
    const quoted = liveFromFirstQuote(base({ markets: [market(USDC_BOOK, USDC)] }));
    expect(decideQuotes({ ...quoted, mark: (MARK * 10_008n) / 10_000n }, cfg)).toBeNull(); // 8 bps: within 10
    const p = decideQuotes({ ...quoted, mark: (MARK * 10_100n) / 10_000n }, cfg)!; // +1%
    const args = decodeBook(p.calldata).args as unknown as [number[], bigint[], number[], bigint[], number[], boolean];
    expect(args[4].map(BigInt)).toEqual(quoted.markets[0]!.live.map((x) => x.id));
    expect(BigInt(args[0][0]!)).toBeGreaterThan(MARK);
    expect((p.inputs as { why: string }).why).toMatch(/bps from mark/);
  });

  it("re-posts capital that fills moved to the other side, and refreshes a quote that is simply old", () => {
    // Past the re-quote gap: fills are re-posted, but not within minutes of the last quote.
    const fresh = liveFromFirstQuote(base({ markets: [market(USDC_BOOK, USDC)] }));
    const later = fresh.now + cfg.minRequoteGapSec + 1n;
    const quoted = { ...fresh, now: later, markAt: later };
    const m = quoted.markets[0]!;
    // 80% of the bids filled: ~1,600 USDC became ~55k MON, now idle in the margin account.
    const bidsFilled = {
      ...quoted,
      marginMon: 55_000n * E18,
      markets: [{ ...m, live: m.live.map((x) => (x.isBuy ? { ...x, size: x.size / 5n } : x)) }],
    };
    expect((decideQuotes(bidsFilled, cfg)?.inputs as { why: string }).why).toBe("re-post filled capital");
    // 80% of the asks filled: the USDC received is idle.
    const asksFilled = {
      ...quoted,
      markets: [{ ...m, marginQuote: 2_300_000_000n, live: m.live.map((x) => (x.isBuy ? x : { ...x, size: x.size / 5n })) }],
    };
    expect((decideQuotes(asksFilled, cfg)?.inputs as { why: string }).why).toBe("re-post filled capital");
    expect(decideQuotes(quoted, cfg)).toBeNull();
    const old = { ...quoted, now: quoted.now + cfg.maxAgeSec + 1n, markAt: quoted.now + cfg.maxAgeSec + 1n };
    expect((decideQuotes(old, cfg)?.inputs as { why: string }).why).toBe("refresh");
  });

  it("gas guard: a just-quoted book waits out the gap unless the mid is close to the engine's band", () => {
    const quoted = liveFromFirstQuote(base({ markets: [market(USDC_BOOK, USDC)] }));
    const at = (bps: bigint, dt: bigint) => ({ ...quoted, now: quoted.now + dt, markAt: quoted.now + dt, mark: (MARK * (10_000n + bps)) / 10_000n });
    expect(decideQuotes(at(20n, 60n), cfg)).toBeNull(); // 20 bps off one minute later: wait
    expect(decideQuotes(at(20n, cfg.minRequoteGapSec + 1n), cfg)?.action).toBe("batchUpdate"); // after the gap: re-centre
    expect(decideQuotes(at(30n, 60n), cfg)?.action).toBe("batchUpdate"); // 30 bps: the engine's band, now
    expect(decideQuotes(at(12n, cfg.minRequoteGapSec + 1n), cfg)).toBeNull(); // 12 bps: inside the 15 bps re-centre threshold
  });

  it("does nothing on a stale mark: the engine would refuse to trade anyway", () => {
    expect(decideQuotes(base({ markAt: 1_800_000_000n - cfg.markMaxAgeSec - 1n }), cfg)).toBeNull();
  });

  it("cancels flip orders left by the seeding script before posting", () => {
    const o = base({ markets: [market(USDC_BOOK, USDC, { live: [{ id: 7n, price: MARK, size: 10n ** 13n, isBuy: true, flip: true, flippedId: 0n }] })] });
    const p = decideQuotes(o, cfg)!;
    expect(p.action).toBe("batchCancelFlipOrders");
    expect(decodeBook(p.calldata).args).toEqual([[7]]);
  });

  it("names one order per linked flip pair: cancelling one cancels both, and naming both reverts", () => {
    // As seen on the fork: #2 was partly filled and spawned #3; #2 and #3 point at each other.
    const live = [
      { id: 1n, price: MARK - 1_000n, size: 10n ** 15n, isBuy: true, flip: true, flippedId: 0n },
      { id: 2n, price: MARK + 1_000n, size: 9n * 10n ** 14n, isBuy: false, flip: true, flippedId: 3n },
      { id: 3n, price: MARK - 1_000n, size: 3n * 10n ** 13n, isBuy: true, flip: true, flippedId: 2n },
    ];
    const p = decideQuotes(base({ markets: [market(USDC_BOOK, USDC, { live })] }), cfg)!;
    expect(decodeBook(p.calldata).args).toEqual([[1, 2]]);
  });

  it("moves wallet funds into Kuru first: approve, then deposit; MON keeps a gas reserve", () => {
    const needsApproval = base({ markets: [market(USDC_BOOK, USDC, { walletQuote: 500_000_000n, allowance: 0n })] });
    const a = decideQuotes(needsApproval, cfg)!;
    expect(a.action).toBe("approve");
    expect(String(decodeFunctionData({ abi: erc20Abi, data: a.calldata as `0x${string}` }).args[0]).toLowerCase()).toBe(MARGIN);

    const d = decideQuotes(base({ markets: [market(USDC_BOOK, USDC, { walletQuote: 500_000_000n })] }), cfg)!;
    expect(d.action).toBe("marginDeposit");
    const [user, token, amount] = decodeFunctionData({ abi: kuruMarginAbi, data: d.calldata as `0x${string}` }).args;
    expect([user.toLowerCase(), token.toLowerCase(), amount]).toEqual([SEEDER, USDC, 500_000_000n]);
    expect(d.value ?? 0n).toBe(0n);

    const mon = decideQuotes(base({ walletMon: 1_000n * E18 }), cfg)!;
    expect(mon.action).toBe("marginDeposit");
    expect(mon.value).toBe(1_000n * E18 - cfg.gasReserveMon);
    expect(decideQuotes(base({ walletMon: cfg.gasReserveMon + E18 }), cfg)?.action).toBe("batchUpdate"); // dust stays
  });

  it("vMON spot (ADR-010): approves then deposits the token, with no native value and no gas reserve", () => {
    const VMON = "0x00000000000000000000000000000000000000f1" as const;
    const a = decideQuotes(base({ spot: VMON, walletMon: 10_000n * E18 }), cfg)!;
    expect(a.action).toBe("approve");
    expect(a.target).toBe(VMON);
    const d = decideQuotes(base({ spot: VMON, walletMon: 10_000n * E18, spotAllowance: 2n ** 255n }), cfg)!;
    expect(d.action).toBe("marginDeposit");
    const [, token, amount] = decodeFunctionData({ abi: kuruMarginAbi, data: d.calldata as `0x${string}` }).args;
    expect([token.toLowerCase(), amount]).toEqual([VMON, 10_000n * E18]); // all of it: gas is native MON
    expect(d.value ?? 0n).toBe(0n);
  });

  it("drops levels below the market's minimum size", () => {
    const thin = base({ marginMon: 2n * E18, markets: [market(USDC_BOOK, USDC, { marginQuote: 30_000n })] });
    const p = decideQuotes(thin, cfg)!;
    const [bp, , sp] = decodeBook(p.calldata).args as unknown as [number[], bigint[], number[]];
    expect(bp).toHaveLength(0); // 0.03 USDC buys less than 1 MON per level
    expect(sp).toHaveLength(1); // 2 MON: 0.8 + 1.2 — only the 1.2 MON level clears the 1 MON minimum
  });

  it("allowlist: book updates, margin deposit (payable), token approvals — nothing else", () => {
    const allow = quoterAllowlist([USDC_BOOK, AUSD_BOOK], MARGIN, [USDC, AUSD]);
    expect(allow.filter((a) => a.payable).map((a) => a.target)).toEqual([MARGIN]);
    expect(allow.map((a) => a.selector)).toContain(toFunctionSelector("batchUpdate(uint32[],uint96[],uint32[],uint96[],uint40[],bool)"));
    expect(allow).toHaveLength(2 * 2 + 1 + 2);
  });
});
