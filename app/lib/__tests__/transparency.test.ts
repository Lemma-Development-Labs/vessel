import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ok, unavailable, type Live } from "../live";
import { Val, Unavailable } from "../../components/live";
import { defaultSandboxLoss, projectNegativeFunding } from "../sandbox";
import { bigintEq, compareLive } from "../disagree";
import { crankTapeLive } from "../envio-tape";
import { netDeltaCastBlock } from "../cast-verify";
import { ADDRESSES } from "../addresses";

/** createElement + render-prop children is awkward under React 19 typings. */
function renderVal<T>(
  of: Live<T>,
  children: (value: T) => ReactNode,
  opts: { nowSec?: number; staleAfterSec?: number } = {},
): string {
  return renderToStaticMarkup(
    createElement(Val as unknown as React.ComponentType<Record<string, unknown>>, {
      of,
      nowSec: opts.nowSec,
      staleAfterSec: opts.staleAfterSec,
      children,
    }),
  );
}

describe("Live renderer — unavailable never shows a numeral", () => {
  it("Unavailable renders an em dash, not 0", () => {
    const html = renderToStaticMarkup(
      createElement(Unavailable, { reason: "venue read reverted" }),
    );
    expect(html).toContain("—");
    expect(html).not.toMatch(/>\s*0\s*</);
    expect(html).toContain('data-live="unavailable"');
    expect(html).toContain("venue read reverted");
  });

  it("Val with unavailable never invokes children", () => {
    let called = false;
    const html = renderVal(unavailable<bigint>("rpc down"), (v) => {
      called = true;
      return String(v);
    });
    expect(called).toBe(false);
    expect(html).toContain("—");
    const text = html
      .replace(/class="[^"]*"/g, "")
      .replace(/title="[^"]*"/g, "")
      .replace(/aria-label="[^"]*"/g, "");
    expect(text).not.toMatch(/\d/);
  });

  it("Val with ok renders phosphor live markup", () => {
    const html = renderVal(ok(12_500_000n, "chain", Math.floor(Date.now() / 1000)), (v) =>
      `notional ${v.toString()}`,
    );
    expect(html).toContain("text-phosphor");
    expect(html).toContain('data-live="ok"');
    expect(html).toContain("notional 12500000");
  });

  it("Val with stale read renders amber + age", () => {
    const asOf = Math.floor(Date.now() / 1000) - 900;
    const html = renderVal(ok(1n, "chain", asOf), (v) => String(v), {
      nowSec: asOf + 900,
      staleAfterSec: 300,
    });
    expect(html).toContain("text-amber");
    expect(html).toContain('data-live="stale"');
    expect(html).toMatch(/old/);
  });
});

describe("Forced-negative sandbox", () => {
  it("Hull principal is untouched; Ballast absorbs first", () => {
    const out = projectNegativeFunding({
      hullTvl: 400_000_000n,
      balTvl: 600_000_000n,
      reserve: 50_000_000n,
      loss: 80_000_000n,
    });
    expect(out.hullTvl).toBe(400_000_000n);
    expect(out.fromBallast).toBe(80_000_000n);
    expect(out.balTvl).toBe(520_000_000n);
    expect(out.fromReserve).toBe(0n);
    expect(out.residual).toBe(0n);
  });

  it("spills into reserve after Ballast is exhausted", () => {
    const out = projectNegativeFunding({
      hullTvl: 100n,
      balTvl: 30n,
      reserve: 40n,
      loss: 50n,
    });
    expect(out.hullTvl).toBe(100n);
    expect(out.fromBallast).toBe(30n);
    expect(out.fromReserve).toBe(20n);
    expect(out.residual).toBe(0n);
  });

  it("default loss is 1% of Ballast", () => {
    expect(defaultSandboxLoss(10_000_000n)).toBe(100_000n);
    expect(defaultSandboxLoss(0n)).toBe(0n);
  });
});

describe("On-chain vs API disagreement", () => {
  it("incomplete when API is unavailable", () => {
    const r = compareLive(
      ok(100n, "chain", 1),
      unavailable<bigint>("api down"),
      bigintEq,
      String,
    );
    expect(r.kind).toBe("incomplete");
  });

  it("disagree when both ok and unequal", () => {
    const r = compareLive(ok(100n, "chain", 1), ok(99n, "stats", 1), bigintEq, String);
    expect(r.kind).toBe("disagree");
    if (r.kind === "disagree") {
      expect(r.message).toContain("100");
      expect(r.message).toContain("99");
    }
  });

  it("agree when equal", () => {
    const r = compareLive(ok(7n, "chain", 1), ok(7n, "stats", 1), bigintEq, String);
    expect(r.kind).toBe("agree");
  });
});

describe("Envio crank tape GATE-0", () => {
  it("is unavailable until schema is verified", () => {
    const tape = crankTapeLive();
    expect(tape.status).toBe("unavailable");
    if (tape.status === "unavailable") {
      expect(tape.reason).toMatch(/GATE-0/i);
      expect(tape.reason).not.toMatch(/keeper json/i);
    }
  });
});

describe("cast verify block", () => {
  it("embeds synced EngineLite / SimVenue / MockWMON addresses", () => {
    const block = netDeltaCastBlock();
    expect(block).toContain(ADDRESSES.EngineLite);
    expect(block).toContain(ADDRESSES.SimVenue);
    expect(block).toContain(ADDRESSES.MockWMON);
    expect(block).toMatch(/netDelta\(/);
  });
});

describe("review bar — no fabricated zeros / no invented liq band", () => {
  it("transparency route has no ?? 0 / || 0 / Number(x) || 0", () => {
    const src = readFileSync(resolve(__dirname, "../../components/transparency-screen.tsx"), "utf8");
    const page = readFileSync(resolve(__dirname, "../../app/transparency/page.tsx"), "utf8");
    for (const [name, text] of [
      ["transparency-screen", src],
      ["page", page],
    ] as const) {
      const hits = text
        .split("\n")
        .map((line, i) => [i + 1, line.trim()] as const)
        .filter(([, line]) => /(\?\?|\|\|)\s*0\b|Number\([^)]*\)\s*\|\|\s*0/.test(line));
      expect(hits, `${name}: ${JSON.stringify(hits)}`).toEqual([]);
    }
  });

  it("explicitly refuses an invented liquidation band", () => {
    const src = readFileSync(resolve(__dirname, "../../components/transparency-screen.tsx"), "utf8");
    expect(src).toMatch(/not shown — Perpl docs do not publish a liquidation band/);
  });
});
