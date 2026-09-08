/**
 * Server-side Dune API helpers.
 * Docs: https://docs.dune.com/api-reference/overview/introduction
 *
 * Never call from the browser with DUNE_API_KEY — use /api/dune/*.
 */

import { duneApiKey, duneOverviewQueryId, type DuneOverviewRow } from "./dune";

const DUNE_API = "https://api.dune.com/api/v1";

export type DuneFetchResult =
  | { status: "ok"; value: DuneOverviewRow; source: string; asOf: number }
  | { status: "unavailable"; reason: string };

async function duneFetch(
  path: string,
  fetchImpl: typeof fetch,
  init?: RequestInit,
): Promise<Response> {
  const key = duneApiKey();
  if (!key) throw new Error("DUNE_API_KEY unset");
  return fetchImpl(`${DUNE_API}${path}`, {
    ...init,
    headers: {
      "X-Dune-API-Key": key,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
}

/**
 * Execute a saved query and poll until complete (or timeout).
 * Requires DUNE_API_KEY + query id. Credits are billed on Dune's side.
 */
export async function fetchDuneOverview(
  fetchImpl: typeof fetch = fetch,
): Promise<DuneFetchResult> {
  const queryId = duneOverviewQueryId();
  if (!queryId) {
    return {
      status: "unavailable",
      reason:
        "NEXT_PUBLIC_DUNE_QUERY_OVERVIEW unset — publish dune/queries/04_overview.sql first",
    };
  }
  if (!duneApiKey()) {
    return {
      status: "unavailable",
      reason: "DUNE_API_KEY unset — server cannot execute Dune queries",
    };
  }

  try {
    const execRes = await duneFetch(`/query/${queryId}/execute`, fetchImpl, {
      method: "POST",
      body: JSON.stringify({ performance: "medium" }),
    });
    if (!execRes.ok) {
      return {
        status: "unavailable",
        reason: `Dune execute HTTP ${execRes.status}`,
      };
    }
    const execBody = (await execRes.json()) as { execution_id?: string };
    const executionId = execBody.execution_id;
    if (!executionId) {
      return { status: "unavailable", reason: "Dune execute returned no execution_id" };
    }

    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const st = await duneFetch(`/execution/${executionId}/results`, fetchImpl);
      if (!st.ok) {
        return { status: "unavailable", reason: `Dune results HTTP ${st.status}` };
      }
      const body = (await st.json()) as {
        state?: string;
        result?: { rows?: Record<string, unknown>[] };
      };
      if (body.state === "QUERY_STATE_FAILED") {
        return { status: "unavailable", reason: "Dune query failed" };
      }
      if (body.state === "QUERY_STATE_COMPLETED") {
        const row = body.result?.rows?.[0];
        if (!row) {
          return { status: "unavailable", reason: "Dune overview returned zero rows" };
        }
        const value: DuneOverviewRow = {
          crank_events: Number(row.crank_events ?? NaN),
          waterfall_events: Number(row.waterfall_events ?? NaN),
          join_events: Number(row.join_events ?? NaN),
          deploy_events: Number(row.deploy_events ?? NaN),
          dune_schema: String(row.dune_schema ?? "monad_testnet"),
          chain_id: Number(row.chain_id ?? 10143),
        };
        if (
          [value.crank_events, value.waterfall_events, value.join_events, value.deploy_events].some(
            (n) => Number.isNaN(n),
          )
        ) {
          return {
            status: "unavailable",
            reason: "Dune overview row missing numeric fields — refusing to invent zeros",
          };
        }
        return {
          status: "ok",
          value,
          source: `dune:query/${queryId}`,
          asOf: Date.now(),
        };
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return { status: "unavailable", reason: "Dune query timed out" };
  } catch (err) {
    return {
      status: "unavailable",
      reason: `Dune unreachable — ${err instanceof Error ? err.message : "network error"}`,
    };
  }
}
