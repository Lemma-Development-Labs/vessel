import type { Live } from "../live";
import { PAUSE, RULES, type BookState, type DepositRequest, type ExitRequest, type Series, type TrancheKind, type Wallet } from "./types";

/**
 * Pre-flight planning for the v2 book. Each check mirrors a revert in
 * TrancheController, so the user is told why an action cannot go through
 * before paying gas for a transaction that will fail. The chain still decides;
 * any input we could not read yields "unknown", never an optimistic "ok".
 */

export type Plan =
  | { kind: "ok"; needsApprove: boolean; minOut: bigint }
  | { kind: "blocked"; reason: string }
  | { kind: "unknown"; reason: string };

/** Default tolerance on Ballast unit price between request and admission. */
export const BALLAST_SLIPPAGE_BPS = 100n;

/** Units a deposit buys at the current unit price (mirrors _unitsFor, floors). */
export function previewUnits(assets: bigint, b: Pick<BookState, "ballastNav" | "ballastSupply" | "virtualUnits" | "virtualAssets">): bigint {
  return (assets * (b.ballastSupply + b.virtualUnits)) / (b.ballastNav + b.virtualAssets);
}

/** dUSD that units are worth at the current unit price (mirrors _assetsFor, floors). */
export function previewAssets(units: bigint, b: Pick<BookState, "ballastNav" | "ballastSupply" | "virtualUnits" | "virtualAssets">): bigint {
  return (units * (b.ballastNav + b.virtualAssets)) / (b.ballastSupply + b.virtualUnits);
}

/** Units that can still be put into a new exit: balanceOf already includes the locked ones. */
export function freeBallastUnits(w: Pick<Wallet, "ballastUnits" | "ballastLocked">): bigint {
  return w.ballastUnits > w.ballastLocked ? w.ballastUnits - w.ballastLocked : 0n;
}

export function withSlippage(x: bigint, bps = BALLAST_SLIPPAGE_BPS): bigint {
  return (x * (10_000n - bps)) / 10_000n;
}

export function planDeposit(args: {
  tranche: TrancheKind;
  seriesId: bigint;
  assets: bigint;
  now: bigint;
  book: Live<BookState>;
  wallet: Live<Wallet>;
  series: Live<Series[]>;
}): Plan {
  const { tranche, seriesId, assets, now, book, wallet, series } = args;
  if (assets <= 0n) return { kind: "unknown", reason: "enter an amount" };
  if (wallet.status !== "ok") return { kind: "unknown", reason: wallet.reason };
  if (book.status !== "ok") return { kind: "unknown", reason: book.reason };
  const b = book.value;
  const w = wallet.value;

  if (b.pausedMask & PAUSE.ADMISSION) return { kind: "blocked", reason: "Deposits are paused by the guardian." };
  if (b.impaired) return { kind: "blocked", reason: "The book is impaired — new deposits are closed." };
  if (w.betaAllowance === 0n) {
    return { kind: "blocked", reason: "This wallet is not on the beta allowlist yet. Access goes out in waves." };
  }
  const used = w.admitted + w.reserved;
  if (used + assets > w.betaAllowance) {
    const left = w.betaAllowance > used ? w.betaAllowance - used : 0n;
    return { kind: "blocked", reason: `Above your beta allowance — ${fmt(left)} dUSD left.` };
  }
  const stageUsed = b.lifetimeAdmitted + b.pendingReserved;
  if (stageUsed + assets > b.stageCap) {
    const left = b.stageCap > stageUsed ? b.stageCap - stageUsed : 0n;
    return { kind: "blocked", reason: `Above the beta stage cap — ${fmt(left)} dUSD of capacity left.` };
  }
  if (w.dusd < assets) return { kind: "blocked", reason: "Not enough dUSD in this wallet — use the faucet." };

  let minOut: bigint;
  if (tranche === "hull") {
    if (series.status !== "ok") return { kind: "unknown", reason: series.reason };
    const s = series.value.find((x) => x.id === seriesId);
    if (!s || s.state !== "SUBSCRIPTION_OPEN") return { kind: "blocked", reason: "No Hull series is open for subscription." };
    if (now >= s.subscriptionEnd) return { kind: "blocked", reason: "The subscription window has closed." };
    if (s.subscriptions >= RULES.MAX_SUBSCRIBERS) return { kind: "blocked", reason: "This series is full (25 subscribers)." };
    // Hull minOut is the minimum rate: accept exactly the published series rate.
    minOut = s.rateBps;
  } else {
    if (seriesId !== 0n) return { kind: "blocked", reason: "Ballast deposits do not take a series." };
    minOut = withSlippage(previewUnits(assets, b));
  }
  return { kind: "ok", needsApprove: w.custodyAllowance < assets, minOut };
}

/** Deadline for a new request: Hull must survive activation; Ballast waits for the keeper. */
export function depositDeadline(tranche: TrancheKind, now: bigint, s?: Pick<Series, "subscriptionEnd">): bigint {
  if (tranche === "hull" && s) return s.subscriptionEnd + 24n * 3600n;
  return now + 24n * 3600n;
}

export type ExitPhase =
  | { kind: "cooling"; readyAt: bigint; secondsLeft: bigint }
  | { kind: "queued"; partial: boolean }
  | { kind: "claimable"; amount: bigint }
  | { kind: "done" }
  | { kind: "cancelled" };

export function exitPhase(e: ExitRequest, now: bigint): ExitPhase {
  // Escrowed money is claimable whatever happened to the rest: a partly filled exit
  // that was then cancelled still owes its funded part.
  if (e.claimable > 0n) return { kind: "claimable", amount: e.claimable };
  if (e.status === "CANCELLED") return { kind: "cancelled" };
  if (e.status === "FUNDED") return { kind: "done" };
  const readyAt = e.requestedAt + RULES.EXIT_COOLDOWN_SEC;
  if (now < readyAt) return { kind: "cooling", readyAt, secondsLeft: readyAt - now };
  return { kind: "queued", partial: e.funded > 0n };
}

/** Plain-language status for a deposit request. */
export function depositLabel(d: DepositRequest): string {
  switch (d.status) {
    case "ESCROWED":
      return d.tranche === "hull" ? "Subscribed — admitted at activation" : "Waiting for admission";
    case "ADMITTED":
      return "Admitted";
    case "REFUNDABLE":
      return "Not admitted — refund ready";
    case "REFUNDED":
      return "Refunded";
    default:
      return "Unknown";
  }
}

export function canCancelDeposit(d: DepositRequest, series: Series[] | null, now: bigint): boolean {
  if (d.status !== "ESCROWED") return false;
  if (d.tranche === "ballast") return true;
  const s = series?.find((x) => x.id === d.seriesId);
  return !!s && s.state === "SUBSCRIPTION_OPEN" && now < s.subscriptionEnd;
}

/** Human labels for series states. */
export const SERIES_LABEL: Record<Series["state"], string> = {
  NONE: "—",
  SUBSCRIPTION_OPEN: "Subscription open",
  CANCELLED: "Cancelled",
  ACTIVE: "Active",
  MATURED_UNWINDING: "Matured — unwinding",
  CLAIMABLE: "Claimable",
  CLOSED: "Closed",
  IMPAIRED: "Impaired",
};

function fmt(x: bigint): string {
  const whole = x / 1_000_000n;
  const frac = (x % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${whole.toLocaleString("en-US")}.${frac}`;
}
