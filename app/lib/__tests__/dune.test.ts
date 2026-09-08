import { afterEach, describe, expect, it } from "vitest";
import {
  duneApiKey,
  duneConfigured,
  duneDashboardUrl,
  duneOverviewQueryId,
} from "../dune";
import { fetchDuneOverview } from "../dune-server";

const KEYS = [
  "NEXT_PUBLIC_DUNE_DASHBOARD_URL",
  "NEXT_PUBLIC_DUNE_QUERY_OVERVIEW",
  "DUNE_API_KEY",
] as const;

afterEach(() => {
  for (const key of KEYS) {
    delete process.env[key];
  }
});

describe("dune config", () => {
  it("is unset when no env", () => {
    expect(duneDashboardUrl()).toBeUndefined();
    expect(duneOverviewQueryId()).toBeUndefined();
    expect(duneApiKey()).toBeUndefined();
    expect(duneConfigured()).toBe(false);
  });

  it("reads dashboard and overview query id", () => {
    process.env.NEXT_PUBLIC_DUNE_DASHBOARD_URL =
      "https://dune.com/lemma/vessel";
    process.env.NEXT_PUBLIC_DUNE_QUERY_OVERVIEW = "12345";
    expect(duneDashboardUrl()).toBe("https://dune.com/lemma/vessel");
    expect(duneOverviewQueryId()).toBe("12345");
    expect(duneConfigured()).toBe(true);
  });

  it("treats blank strings as unset", () => {
    process.env.NEXT_PUBLIC_DUNE_DASHBOARD_URL = "   ";
    process.env.NEXT_PUBLIC_DUNE_QUERY_OVERVIEW = "";
    expect(duneDashboardUrl()).toBeUndefined();
    expect(duneOverviewQueryId()).toBeUndefined();
    expect(duneConfigured()).toBe(false);
  });

  it("reads server API key", () => {
    process.env.DUNE_API_KEY = "dune_xyz";
    expect(duneApiKey()).toBe("dune_xyz");
  });
});

describe("fetchDuneOverview honesty", () => {
  it("is unavailable without query id", async () => {
    const r = await fetchDuneOverview();
    expect(r.status).toBe("unavailable");
    if (r.status === "unavailable") expect(r.reason).toMatch(/unset/);
  });

  it("is unavailable without API key when query id set", async () => {
    process.env.NEXT_PUBLIC_DUNE_QUERY_OVERVIEW = "999";
    const r = await fetchDuneOverview();
    expect(r.status).toBe("unavailable");
    if (r.status === "unavailable") expect(r.reason).toMatch(/DUNE_API_KEY/);
  });

  it("refuses incomplete Dune rows (no invented zeros)", async () => {
    process.env.NEXT_PUBLIC_DUNE_QUERY_OVERVIEW = "999";
    process.env.DUNE_API_KEY = "test-key";
    let calls = 0;
    const fakeFetch: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ execution_id: "exec-1" }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          state: "QUERY_STATE_COMPLETED",
          result: { rows: [{ crank_events: 1 }] },
        }),
        { status: 200 },
      );
    };
    const r = await fetchDuneOverview(fakeFetch);
    expect(r.status).toBe("unavailable");
    if (r.status === "unavailable") expect(r.reason).toMatch(/invent/);
  });
});
