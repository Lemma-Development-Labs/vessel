import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ageSec,
  fromMulticall,
  isStale,
  map2,
  mapLive,
  ok,
  unavailable,
  valueOrForLogic,
  type Live,
} from "../live";

const APP = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(join(APP, rel), "utf8");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}


/**
 * Live<T> fields on the provider. `connected`, `wrongNetwork`, `loading`,
 * `impaired` and `isMock` are plain booleans and are legitimately truthy-tested.
 */
const LIVE_TOP = "dusdBalance|hullShares|balShares|paused";
const LIVE_GROUP = "engine|deck|vault|faucetState|hullMeta|balMeta";

/** `v.paused ?`, `!v.paused`, `v.engine.shortId &&` — object in a boolean slot. */
function truthinessHits(line: string): string[] {
  const out: string[] = [];
  const pats = [
    new RegExp(`\\bv\\.(?:${LIVE_TOP})\\s*(?:\\?(?!\\.)|&&|\\|\\|)`, "g"),
    new RegExp(`!\\s*v\\.(?:${LIVE_TOP})\\b(?!\\s*\\.)`, "g"),
    new RegExp(`\\bv\\.(?:${LIVE_GROUP})\\.[A-Za-z0-9_]+\\s*(?:\\?(?!\\.)|&&|\\|\\|)`, "g"),
    new RegExp(`!\\s*v\\.(?:${LIVE_GROUP})\\.[A-Za-z0-9_]+\\b(?!\\s*\\.)`, "g"),
  ];
  for (const re of pats) for (const m of line.matchAll(re)) out.push(m[0].trim());
  return out;
}

/**
 * The structural half of Rule 0. These tests are the reason a fabricated live
 * value cannot come back by accident: they fail the build, not a review.
 */
describe("Rule 0 — the live provider never lies", () => {
  it("the live provider does not import the mock module", () => {
    const chain = read("lib/chain.tsx");
    // Any import that resolves to lib/mock, however it is spelled.
    const offenders = chain
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /^\s*(import|export)[^;]*from\s+["'][^"']*\bmock\b[^"']*["']/.test(line))
      .concat(
        chain
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /\bimport\(\s*["'][^"']*\bmock\b/.test(line)),
      );
    expect(
      offenders,
      `lib/chain.tsx must never import from the mock module. Offending lines: ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });

  it("the live provider never constructs a mock-sourced value", () => {
    const chain = read("lib/chain.tsx");
    expect(chain).not.toMatch(/["']mock["']/);
  });

  it("no live-path file silently defaults a chain read to zero", () => {
    // `?? 0n` / `|| 0n` / `?? 0` on a read result is exactly the bug Rule 0
    // exists to prevent. Files that legitimately need a numeric default for
    // pure layout math opt out with an inline `rule0-ok` comment.
    const liveFiles = ["lib/chain.tsx", "lib/stats.ts"];
    const problems: string[] = [];
    for (const rel of liveFiles) {
      read(rel)
        .split("\n")
        .forEach((line, i) => {
          if (line.includes("rule0-ok")) return;
          if (/(\?\?|\|\|)\s*0n?\b/.test(line)) problems.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(problems, `Fabricated zero-defaults in live paths:\n${problems.join("\n")}`).toEqual([]);
  });

  it("no component reads a Live<T> value without first checking status", () => {
    // Pulling `.value` off a Live<T> is only safe behind a status check. This
    // flags UNGUARDED access: a `.value` read with no `<same field>.status ===
    // "ok"` on the line itself or in the few lines just above it (the guard is
    // often the opening line of a ternary or `&&`).
    //
    // This is the check that would catch someone "fixing" an unavailable
    // render by reaching past the type instead of handling the branch.
    const GUARD_WINDOW = 4;
    const files = walk(join(APP, "components")).concat(walk(join(APP, "app")));
    const problems: string[] = [];

    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.includes("rule0-ok")) return;
        const access = /\bv\.(engine|deck|vault|faucetState)\.([A-Za-z0-9_]+)\.value\b/g;
        for (const m of line.matchAll(access)) {
          const field = `${m[1]}.${m[2]}`;
          const window = lines.slice(Math.max(0, i - GUARD_WINDOW), i + 1).join("\n");
          const guarded =
            window.includes(`${field}.status === "ok"`) ||
            window.includes(`${field}.status !== "ok"`);
          if (!guarded) {
            problems.push(`${f.replace(APP + "/", "")}:${i + 1}: ${line.trim()}`);
          }
        }
      });
    }
    expect(problems, `Unguarded .value access on provider fields:\n${problems.join("\n")}`).toEqual(
      [],
    );
  });

  it("no component tests a Live<T> for truthiness", () => {
    // A Live<T> is always an OBJECT, so `v.paused ? …` is ALWAYS true. That
    // shipped: the shell rendered "Guardian pause is on" on every screen while
    // the chain reported paused=false. It is the same fabrication class as a
    // defaulted zero, but the type system cannot catch it — an object in a
    // boolean position is legal TypeScript — so it has to be caught here.
    const files = walk(join(APP, "components")).concat(walk(join(APP, "app")));
    const problems: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (line.includes("rule0-ok")) return;
          for (const hit of truthinessHits(line)) {
            problems.push(`${f.replace(APP + "/", "")}:${i + 1}: ${hit}`);
          }
        });
    }
    expect(
      problems,
      `Live<T> tested for truthiness (always true — check .status instead):\n${problems.join("\n")}`,
    ).toEqual([]);
  });

  it("the truthiness detector actually catches a planted violation", () => {
    const bad = [
      "      {v.paused ? <Banner /> : null}",
      "      if (!v.dusdBalance) return null;",
      "      const x = v.engine.shortId && other;",
    ];
    const good = [
      '      {v.paused.status === "ok" && v.paused.value ? <Banner /> : null}',
      "      const n = valueOrForLogic(v.dusdBalance, 0n);",
      "      <Val of={v.engine.shortId}>{(s) => String(s)}</Val>",
      "      if (v.connected && !v.wrongNetwork) return null;",
    ];
    expect(bad.flatMap(truthinessHits)).toHaveLength(3);
    expect(good.flatMap(truthinessHits)).toHaveLength(0);
  });

  it("the guard check actually catches an unguarded read", () => {
    // Guards the guard: if the detector above stopped matching, it would go
    // green on a codebase full of unguarded reads and prove nothing.
    const GUARD_WINDOW = 4;
    const bad = ['const x = v.engine.fundingAccrued.value;'];
    const good = [
      'v.engine.fundingAccrued.status === "ok" ? (',
      "  v.engine.fundingAccrued.value",
      ") : null",
    ];
    const scan = (lines: string[]) => {
      const hits: string[] = [];
      lines.forEach((line, i) => {
        for (const m of line.matchAll(
          /\bv\.(engine|deck|vault|faucetState)\.([A-Za-z0-9_]+)\.value\b/g,
        )) {
          const field = `${m[1]}.${m[2]}`;
          const window = lines.slice(Math.max(0, i - GUARD_WINDOW), i + 1).join("\n");
          if (!window.includes(`${field}.status === "ok"`)) hits.push(line);
        }
      });
      return hits;
    };
    expect(scan(bad)).toHaveLength(1);
    expect(scan(good)).toHaveLength(0);
  });
});

describe("Live<T> algebra", () => {
  it("unavailable carries no value field at all", () => {
    const u = unavailable<bigint>("venue read reverted");
    expect(u.status).toBe("unavailable");
    expect("value" in u).toBe(false);
  });

  it("mapLive preserves source and asOf, and propagates unavailable", () => {
    const a = ok(5n, "chain", 100);
    expect(mapLive(a, (x) => x * 2n)).toEqual({ status: "ok", value: 10n, source: "chain", asOf: 100 });
    const u = unavailable<bigint>("nope");
    expect(mapLive(u, (x) => x * 2n)).toBe(u);
  });

  it("map2 is contagious: one unavailable input makes the result unavailable", () => {
    const a = ok(5n, "chain", 100);
    const b = unavailable<bigint>("short notional read reverted");
    const r = map2(a, b, (x, y) => x + y);
    expect(r.status).toBe("unavailable");
    if (r.status === "unavailable") expect(r.reason).toBe("short notional read reverted");
  });

  it("map2 attributes a combined value to its least-direct source and oldest read", () => {
    const r = map2(ok(1n, "chain", 200), ok(2n, "stats", 150), (x, y) => x + y);
    expect(r).toEqual({ status: "ok", value: 3n, source: "stats", asOf: 150 });
  });

  it("fromMulticall turns a reverted read into unavailable, not zero", () => {
    const failed = fromMulticall<bigint>({ status: "failure" }, 10, "funding accrued");
    expect(failed.status).toBe("unavailable");
    if (failed.status === "unavailable") expect(failed.reason).toContain("funding accrued");

    const missing = fromMulticall<bigint>(undefined, 10, "funding accrued");
    expect(missing.status).toBe("unavailable");

    const good = fromMulticall<bigint>({ status: "success", result: 7n }, 10, "funding accrued");
    expect(good).toEqual({ status: "ok", value: 7n, source: "chain", asOf: 10 });
  });

  it("fromMulticall rejects a wrong-typed result rather than coercing it", () => {
    const isBig = (v: unknown): v is bigint => typeof v === "bigint";
    const wrong = fromMulticall<bigint>({ status: "success", result: "0x1" }, 10, "net delta", isBig);
    expect(wrong.status).toBe("unavailable");
  });

  it("staleness: unavailable is always stale; a fresh ok read is not", () => {
    const fresh: Live<bigint> = ok(1n, "chain", 1_000);
    expect(isStale(fresh, 1_010, 300)).toBe(false);
    expect(isStale(fresh, 1_400, 300)).toBe(true);
    expect(isStale(unavailable<bigint>("x"), 1_000, 300)).toBe(true);
    expect(ageSec(fresh, 1_010)).toBe(10);
    expect(ageSec(unavailable<bigint>("x"), 1_010)).toBe(null);
  });

  it("valueOrForLogic is the only escape hatch and is not used for display", () => {
    expect(valueOrForLogic(unavailable<bigint>("x"), 0n)).toBe(0n);
    expect(valueOrForLogic(ok(3n, "chain", 1), 0n)).toBe(3n);
  });
});
