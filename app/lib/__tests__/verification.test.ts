import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VERIFICATION, verificationOf, type VerificationState } from "../verification";

const APP = resolve(__dirname, "../..");
const ROOT = resolve(APP, "..");

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
 * A literal "verified" handed to <Badge kind=…>. That is the exact shape of the
 * bug: the badge asserted a status instead of reading one, on all 11 contracts,
 * when only DemoUSD's Sourcify verification was ever confirmed.
 *
 * `kind="sim"` and `kind="hedged"` are deliberately NOT matched — those are
 * literals too, but they describe the venue mode, which is a chain read.
 * Verification is the one badge that must come from the manifest.
 */
const LITERAL_VERIFIED_BADGE =
  /kind\s*=\s*(?:"verified"|'verified'|\{\s*(?:"verified"|'verified'|`verified`)\s*\})/g;

function literalVerifiedBadges(source: string): string[] {
  return source
    .split("\n")
    .map((line, i) => [i + 1, line] as const)
    .filter(([, line]) => {
      LITERAL_VERIFIED_BADGE.lastIndex = 0;
      return LITERAL_VERIFIED_BADGE.test(line);
    })
    .map(([n, line]) => `${n}: ${line.trim()}`);
}

/** Symmetric difference between the manifest keys and the deployed contracts. */
function manifestDrift(manifestNames: string[], deployedNames: string[]) {
  return {
    missingFromManifest: deployedNames.filter((n) => !manifestNames.includes(n)),
    notDeployed: manifestNames.filter((n) => !deployedNames.includes(n)),
  };
}

const STATES: VerificationState[] = ["verified", "unverified", "unknown"];

const deployed: Record<string, string> = JSON.parse(
  readFileSync(join(ROOT, "ADDRESSES.json"), "utf8"),
).contracts;

describe("verification badge — status is read, never asserted", () => {
  it("transparency-screen.tsx never hardcodes a verified badge", () => {
    const offenders = literalVerifiedBadges(read("components/transparency-screen.tsx"));
    expect(
      offenders,
      `components/transparency-screen.tsx must derive Badge kind from lib/verification.ts, ` +
        `not from a literal. Offending lines:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("no component anywhere hardcodes a verified badge", () => {
    // Moving the contracts table to another file must not shed the rule.
    const files = walk(join(APP, "components")).concat(walk(join(APP, "app")));
    const offenders: string[] = [];
    for (const f of files) {
      for (const hit of literalVerifiedBadges(readFileSync(f, "utf8"))) {
        offenders.push(`${f.replace(APP + "/", "")}:${hit}`);
      }
    }
    expect(offenders, `Hardcoded verified badges:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the literal-badge detector actually catches a planted violation", () => {
    // Guards the guard: a detector that stopped matching would go green on a
    // screen full of fabricated badges and prove nothing.
    const bad = [
      '        <Badge kind="verified" />',
      "        <Badge kind={'verified'} />",
      '        <Badge kind={"verified"} />',
    ];
    const good = [
      "        <Badge kind={entry.state} />",
      '        {simulated ? <Badge kind="sim" /> : <Badge kind="hedged" />}',
      '        <Badge kind="testnet" />',
    ];
    expect(literalVerifiedBadges(bad.join("\n"))).toHaveLength(3);
    expect(literalVerifiedBadges(good.join("\n"))).toHaveLength(0);
  });

  it("transparency-screen.tsx reads the generated manifest", () => {
    // Without the import there is no state to render, and the dim label would
    // be just as hardcoded as the badge it replaced.
    const src = read("components/transparency-screen.tsx");
    expect(src).toMatch(/import\s*\{[^}]*\bverificationOf\b[^}]*\}\s*from\s*["']@\/lib\/verification["']/);
    // …and the badge it renders takes its kind from that manifest entry.
    expect(src).toMatch(/<Badge\s+kind=\{entry\.state\}/);
  });
});

describe("the manifest tracks the deployment exactly", () => {
  it("every deployed contract has an entry, and every entry is deployed", () => {
    const drift = manifestDrift(Object.keys(VERIFICATION), Object.keys(deployed));
    expect(
      drift,
      `lib/verification.ts is out of sync with ADDRESSES.json. Run: pnpm verify:manifest`,
    ).toEqual({ missingFromManifest: [], notDeployed: [] });
  });

  it("the drift detector actually catches a planted mismatch", () => {
    expect(manifestDrift(["Hull", "Ballast"], ["Hull", "Ballast"])).toEqual({
      missingFromManifest: [],
      notDeployed: [],
    });
    // A contract deployed by the redeploy but never added to the manifest.
    expect(manifestDrift(["Hull"], ["Hull", "Ballast"]).missingFromManifest).toEqual(["Ballast"]);
    // A stale entry left behind from the previous deployment.
    expect(manifestDrift(["Hull", "OldVault"], ["Hull"]).notDeployed).toEqual(["OldVault"]);
  });

  it("every entry carries a state the type actually allows", () => {
    const bad = Object.entries(VERIFICATION)
      .filter(([, e]) => !STATES.includes(e.state))
      .map(([n, e]) => `${n}: ${JSON.stringify(e.state)}`);
    expect(bad, `Unknown verification states:\n${bad.join("\n")}`).toEqual([]);
  });

  it("a verified entry must carry the timestamp that proves it was checked", () => {
    // "verified" with checkedAt: null is the unfalsifiable claim again, just
    // moved from the component into the manifest.
    const undated = Object.entries(VERIFICATION)
      .filter(([, e]) => e.state === "verified" && !e.checkedAt)
      .map(([n]) => n);
    expect(undated, `Verified with no checkedAt:\n${undated.join("\n")}`).toEqual([]);
  });

  it("a checkedAt is a real instant, not a hand-typed placeholder", () => {
    const bad = Object.entries(VERIFICATION)
      .filter(([, e]) => e.checkedAt !== null && Number.isNaN(Date.parse(e.checkedAt)))
      .map(([n, e]) => `${n}: ${JSON.stringify(e.checkedAt)}`);
    expect(bad, `Unparseable checkedAt:\n${bad.join("\n")}`).toEqual([]);
  });

  it("the manifest is marked generated so nobody hand-edits a state onto the page", () => {
    const head = read("lib/verification.ts").split("\n").slice(0, 3).join("\n");
    expect(head).toMatch(/Generated by/);
    expect(head).toMatch(/do not edit by hand/i);
  });

  it("an unlisted contract falls back to unknown, never to verified", () => {
    expect(verificationOf("NotADeployedContract")).toEqual({ state: "unknown", checkedAt: null });
  });

  it("the current seed is all-unknown — the redeploy invalidated every prior check", () => {
    // Documents the state R4.3 shipped with. When a verification run against
    // the NEW addresses updates the manifest, update this expectation with it.
    expect(Object.values(VERIFICATION).map((e) => e.state)).toEqual(
      Object.keys(deployed).map(() => "unknown"),
    );
  });
});
