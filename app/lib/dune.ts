/**
 * Dune analytics config — honesty bar: empty env ⇒ unavailable, never invent series.
 * Dashboard / query IDs must be published on dune.com against monad_testnet.
 */

export type DuneOverviewRow = {
  crank_events: number;
  waterfall_events: number;
  join_events: number;
  deploy_events: number;
  dune_schema: string;
  chain_id: number;
};

export function duneDashboardUrl(): string | undefined {
  const u = process.env.NEXT_PUBLIC_DUNE_DASHBOARD_URL?.trim();
  return u && u.length > 0 ? u : undefined;
}

export function duneOverviewQueryId(): string | undefined {
  const id = process.env.NEXT_PUBLIC_DUNE_QUERY_OVERVIEW?.trim();
  return id && id.length > 0 ? id : undefined;
}

export function duneApiKey(): string | undefined {
  const k = process.env.DUNE_API_KEY?.trim();
  return k && k.length > 0 ? k : undefined;
}

/** Client-side: whether the public dashboard surface is configured. */
export function duneConfigured(): boolean {
  return Boolean(duneDashboardUrl() || duneOverviewQueryId());
}
