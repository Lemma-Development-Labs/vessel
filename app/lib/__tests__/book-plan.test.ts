import { describe, expect, it } from "vitest";
import { ok, unavailable, type Live } from "../live";
import {
  canCancelDeposit,
  depositDeadline,
  exitPhase,
  planDeposit,
  previewAssets,
  previewUnits,
  withSlippage,
} from "../book/plan";
import { RULES, type BookState, type DepositRequest, type ExitRequest, type Series, type Wallet } from "../book/types";

const d = (n: number) => BigInt(Math.round(n * 1e6));
const NOW = 1_800_000_000n;

const book = (over: Partial<BookState> = {}): Live<BookState> =>
  ok(
    {
      hullNav: d(4_000), ballastNav: d(2_000), reserveNav: d(120), treasuryLiability: 0n, recordedActive: d(6_120),
      lossCarry: 0n, epoch: 3n, impaired: false, coverBps: 3_333n, stageCap: d(25_000), lifetimeAdmitted: d(6_000),
      pendingReserved: 0n, activeSeries: 1n, seriesCount: 1n, ballastSupply: d(2_000) * 10n ** 12n,
      virtualUnits: 10n ** 12n, virtualAssets: 1n, pausedMask: 0, engine: null, ballastQueue: 0n, exitQueue: 0n,
      ...over,
    },
    "chain",
    1,
  );

/** The plain book behind `book()`, for pricing helpers. */
const rawBook = (): BookState => {
  const b = book();
  if (b.status !== "ok") throw new Error("fixture");
  return b.value;
};

const wallet = (over: Partial<Wallet> = {}): Live<Wallet> =>
  ok(
    {
      dusd: d(500), custodyAllowance: 0n, betaAllowance: d(1_000), admitted: d(200), reserved: 0n,
      ballastUnits: 0n, ballastLocked: 0n, ballastValue: 0n, faucetCooldownSec: 0, faucetRemaining: d(900),
      ...over,
    },
    "chain",
    1,
  );

const openSeries: Series = {
  id: 2n, state: "SUBSCRIPTION_OPEN", rateBps: 800n, termsHash: "0x00", subscriptionEnd: NOW + 3600n, activation: 0n,
  maturity: 0n, principal: 0n, recognizedCoupon: 0n, subscriptions: 3n, myUnits: 0n, myClaimable: 0n,
};
const series = (xs: Series[] = [openSeries]): Live<Series[]> => ok(xs, "chain", 1);

const ballast = (assets: bigint, over: { b?: Partial<BookState>; w?: Partial<Wallet> } = {}) =>
  planDeposit({ tranche: "ballast", seriesId: 0n, assets, now: NOW, book: book(over.b), wallet: wallet(over.w), series: series() });

describe("planDeposit mirrors requestDeposit's reverts", () => {
  it("allows a Ballast request inside every limit and asks for approval first", () => {
    const p = ballast(d(100));
    expect(p.kind).toBe("ok");
    if (p.kind === "ok") {
      expect(p.needsApprove).toBe(true);
      // minOut is the previewed unit count less 1%.
      expect(p.minOut).toBe(withSlippage(previewUnits(d(100), rawBook())));
    }
  });

  it("NotEligible: a wallet with no beta allowance is told it is not invited", () => {
    const p = ballast(d(10), { w: { betaAllowance: 0n } });
    expect(p).toMatchObject({ kind: "blocked" });
    expect(p.kind === "blocked" && p.reason).toMatch(/allowlist/);
  });

  it("CapExceeded (wallet): admitted + reserved + assets above the allowance", () => {
    const p = ballast(d(801), { w: { admitted: d(200) } });
    expect(p.kind === "blocked" && p.reason).toMatch(/800\.00 dUSD left/);
  });

  it("CapExceeded (stage): lifetime admitted + pending + assets above the stage cap", () => {
    const p = ballast(d(100), { b: { stageCap: d(6_050) } });
    expect(p.kind === "blocked" && p.reason).toMatch(/stage cap — 50\.00 dUSD/);
  });

  it("paused admission and an impaired book both block", () => {
    expect(ballast(d(10), { b: { pausedMask: 1 } }).kind).toBe("blocked");
    expect(ballast(d(10), { b: { impaired: true } }).kind).toBe("blocked");
    // A pause on another dimension does not block deposits.
    expect(ballast(d(10), { b: { pausedMask: 8 } }).kind).toBe("ok");
  });

  it("not enough dUSD blocks before the wallet is asked to sign", () => {
    expect(ballast(d(600)).kind).toBe("blocked");
  });

  it("Hull: needs an open window with room, and asks for exactly the published rate", () => {
    const hull = (s: Series[]) =>
      planDeposit({ tranche: "hull", seriesId: 2n, assets: d(100), now: NOW, book: book(), wallet: wallet(), series: series(s) });
    expect(hull([openSeries])).toMatchObject({ kind: "ok", minOut: 800n });
    expect(hull([{ ...openSeries, subscriptionEnd: NOW }]).kind).toBe("blocked"); // WindowClosed
    expect(hull([{ ...openSeries, subscriptions: RULES.MAX_SUBSCRIBERS }]).kind).toBe("blocked"); // TooManySubscribers
    expect(hull([{ ...openSeries, state: "ACTIVE" }]).kind).toBe("blocked"); // BadSeries
  });

  it("an unreadable input yields unknown, never ok", () => {
    const p = planDeposit({
      tranche: "ballast", seriesId: 0n, assets: d(10), now: NOW, book: unavailable("rpc down"), wallet: wallet(), series: series(),
    });
    expect(p).toEqual({ kind: "unknown", reason: "rpc down" });
  });
});

describe("Ballast unit pricing", () => {
  it("previewUnits and previewAssets round-trip down, never up", () => {
    const b = rawBook();
    const u = previewUnits(d(123.456789), b);
    expect(previewAssets(u, b)).toBeLessThanOrEqual(d(123.456789));
  });
});

describe("exitPhase", () => {
  const base: ExitRequest = {
    id: 1n, owner: "0x1", receiver: "0x1", requestedAt: NOW - 3600n, status: "COOLING", units: 10n, funded: 0n, claimable: 0n,
  } as ExitRequest;

  it("cools down for 48h, then queues", () => {
    expect(exitPhase(base, NOW)).toMatchObject({ kind: "cooling", secondsLeft: RULES.EXIT_COOLDOWN_SEC - 3600n });
    expect(exitPhase(base, NOW + RULES.EXIT_COOLDOWN_SEC)).toEqual({ kind: "queued", partial: false });
    expect(exitPhase({ ...base, funded: 5n }, NOW + RULES.EXIT_COOLDOWN_SEC)).toEqual({ kind: "queued", partial: true });
  });

  it("a cancelled exit with a funded part still shows the claim", () => {
    expect(exitPhase({ ...base, status: "CANCELLED", units: 0n, funded: 7n, claimable: 7n }, NOW)).toEqual({
      kind: "claimable",
      amount: 7n,
    });
    expect(exitPhase({ ...base, status: "CANCELLED", units: 0n }, NOW)).toEqual({ kind: "cancelled" });
  });
});

describe("request helpers", () => {
  const req = (over: Partial<DepositRequest>): DepositRequest =>
    ({
      id: 1n, owner: "0x1", receiver: "0x1", tranche: "hull", seriesId: 2n, deadline: NOW + 1n, createdAt: NOW, status: "ESCROWED",
      assets: d(1), minOut: 800n, ...over,
    }) as DepositRequest;

  it("Hull requests cancel only while their window is open; Ballast while escrowed", () => {
    expect(canCancelDeposit(req({}), [openSeries], NOW)).toBe(true);
    expect(canCancelDeposit(req({}), [openSeries], NOW + 3600n)).toBe(false);
    expect(canCancelDeposit(req({ tranche: "ballast", seriesId: 0n }), [], NOW)).toBe(true);
    expect(canCancelDeposit(req({ status: "ADMITTED" }), [openSeries], NOW)).toBe(false);
  });

  it("a Hull deadline outlives activation", () => {
    expect(depositDeadline("hull", NOW, openSeries)).toBeGreaterThan(openSeries.subscriptionEnd);
    expect(depositDeadline("ballast", NOW)).toBe(NOW + 86_400n);
  });
});
