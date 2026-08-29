/**
 * RULE 0 — THE LIVE PROVIDER NEVER LIES.
 *
 * Every datum the app displays is a `Live<T>`. There is no way to express
 * "here is a value" without also saying where it came from and when it was
 * read, and no way to express "the read failed" as a number.
 *
 * The point is structural, not stylistic: a live-path bug that would have
 * rendered `0` for a failed chain read is now a type error, because the
 * failure branch carries no `value` field at all.
 *
 * `source: "mock"` exists so the demo provider can satisfy the same interface.
 * The live provider is forbidden from producing it — enforced by
 * `assertNoMockSource` and by lib/__tests__/rule0.test.ts, which also fails if
 * lib/chain.tsx ever imports from lib/mock.
 */

export type LiveSource = "chain" | "stats" | "mock";

export type Live<T> =
  | { readonly status: "ok"; readonly value: T; readonly source: LiveSource; readonly asOf: number }
  | { readonly status: "unavailable"; readonly reason: string };

/** Seconds since epoch. Callers pass an explicit clock so reads are stampable in tests. */
export function ok<T>(value: T, source: LiveSource, asOf: number): Live<T> {
  return { status: "ok", value, source, asOf };
}

/**
 * The only way to represent a missing datum. `reason` is user-facing — it is
 * rendered in a tooltip on the dim `—`, so it must name what is missing and
 * why, e.g. "venue read reverted" not "error".
 */
export function unavailable<T>(reason: string): Live<T> {
  return { status: "unavailable", reason };
}

export function isOk<T>(l: Live<T>): l is Extract<Live<T>, { status: "ok" }> {
  return l.status === "ok";
}

/**
 * Read a value for CONTROL FLOW ONLY — enabling a button, sizing a request.
 * NEVER call this to produce something a user reads: that reintroduces exactly
 * the fabricated-zero bug Rule 0 exists to prevent. For display, render the
 * `Live<T>` itself via <Val> / <Num> in components/live.tsx.
 */
export function valueOrForLogic<T>(l: Live<T>, fallback: T): T {
  return l.status === "ok" ? l.value : fallback;
}

export function mapLive<T, U>(l: Live<T>, fn: (t: T) => U): Live<U> {
  return l.status === "ok" ? ok(fn(l.value), l.source, l.asOf) : l;
}

/**
 * Combine two reads. Unavailable is contagious: a derived number is only as
 * trustworthy as its worst input, so it degrades rather than half-rendering.
 */
export function map2<A, B, U>(a: Live<A>, b: Live<B>, fn: (a: A, b: B) => U): Live<U> {
  if (a.status !== "ok") return a;
  if (b.status !== "ok") return b;
  return ok(fn(a.value, b.value), worstSource(a.source, b.source), Math.min(a.asOf, b.asOf));
}

export function map3<A, B, C, U>(
  a: Live<A>,
  b: Live<B>,
  c: Live<C>,
  fn: (a: A, b: B, c: C) => U,
): Live<U> {
  if (a.status !== "ok") return a;
  if (b.status !== "ok") return b;
  if (c.status !== "ok") return c;
  return ok(
    fn(a.value, b.value, c.value),
    worstSource(worstSource(a.source, b.source), c.source),
    Math.min(a.asOf, b.asOf, c.asOf),
  );
}

/** A combined value is attributed to its least-direct source. */
function worstSource(a: LiveSource, b: LiveSource): LiveSource {
  if (a === "mock" || b === "mock") return "mock";
  if (a === "stats" || b === "stats") return "stats";
  return "chain";
}

/** viem multicall entry shape, structurally typed so we do not import viem here. */
type MulticallEntry = { status: "success"; result: unknown } | { status: "failure"; error?: unknown };

/**
 * Lift one `allowFailure: true` multicall entry into a `Live<T>`.
 * A reverted or absent read becomes `unavailable`, never a default.
 */
export function fromMulticall<T>(
  entry: MulticallEntry | undefined,
  asOf: number,
  reason: string,
  guard?: (v: unknown) => v is T,
): Live<T> {
  if (!entry) return unavailable(`${reason} — read not returned by RPC`);
  if (entry.status !== "success") return unavailable(`${reason} — call reverted`);
  const v = entry.result;
  if (v === undefined || v === null) return unavailable(`${reason} — empty result`);
  if (guard && !guard(v)) return unavailable(`${reason} — unexpected return type`);
  return ok(v as T, "chain", asOf);
}

export function isBigint(v: unknown): v is bigint {
  return typeof v === "bigint";
}

export function isBool(v: unknown): v is boolean {
  return typeof v === "boolean";
}

export function isStr(v: unknown): v is string {
  return typeof v === "string";
}

/**
 * A read older than one crank interval is shown dim with an age label rather
 * than presented as current. Unavailable counts as stale.
 */
export function isStale<T>(l: Live<T>, nowSec: number, maxAgeSec: number): boolean {
  if (l.status !== "ok") return true;
  return nowSec - l.asOf > maxAgeSec;
}

export function ageSec<T>(l: Live<T>, nowSec: number): number | null {
  return l.status === "ok" ? Math.max(0, nowSec - l.asOf) : null;
}

/**
 * Runtime tripwire for the live provider. Rule 0's static half is the type;
 * this is the dynamic half, so a value that reaches the UI mislabelled fails
 * loudly in dev and is downgraded to `unavailable` in production rather than
 * being displayed as if it were a chain read.
 */
export function assertNoMockSource<T>(l: Live<T>, field: string): Live<T> {
  if (l.status === "ok" && l.source === "mock") {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(`Rule 0 violation: live provider produced a mock-sourced value for "${field}"`);
    }
    return unavailable(`${field} — refused: mock-sourced value in a live path`);
  }
  return l;
}
