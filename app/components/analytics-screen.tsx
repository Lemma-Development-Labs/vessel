"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { duneDashboardUrl, duneConfigured, type DuneOverviewRow } from "@/lib/dune";
import { Card, Skeleton } from "@/components/ui";
import { Unavailable } from "@/components/live";

type OverviewLive =
  | { status: "loading" }
  | { status: "ok"; value: DuneOverviewRow; source: string }
  | { status: "unavailable"; reason: string };

/**
 * External analytics surface. Charts/embeds only when a real Dune dashboard
 * URL is configured. Overview cards only when the API route can execute a
 * published query — never invent series.
 */
export function AnalyticsScreen() {
  const dashboard = duneDashboardUrl();
  const [overview, setOverview] = useState<OverviewLive>({ status: "loading" });

  useEffect(() => {
    if (!duneConfigured()) {
      setOverview({
        status: "unavailable",
        reason:
          "NEXT_PUBLIC_DUNE_DASHBOARD_URL and NEXT_PUBLIC_DUNE_QUERY_OVERVIEW unset — publish dune/queries then set env",
      });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/dune/overview", { cache: "no-store" });
        const body = (await res.json()) as OverviewLive & { source?: string };
        if (cancelled) return;
        if (!res.ok || body.status === "unavailable") {
          setOverview({
            status: "unavailable",
            reason:
              body.status === "unavailable"
                ? body.reason
                : `Dune API HTTP ${res.status}`,
          });
          return;
        }
        if (body.status === "ok") {
          setOverview({ status: "ok", value: body.value, source: body.source });
        }
      } catch (err) {
        if (!cancelled) {
          setOverview({
            status: "unavailable",
            reason: `Dune fetch failed — ${err instanceof Error ? err.message : "network"}`,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-[960px] px-4 py-10 sm:px-5 md:py-14">
      <p className="num text-[10.5px] tracking-[0.18em] text-steel">ANALYTICS</p>
      <h1 className="display mt-3 text-[32px] font-bold tracking-[-0.02em] sm:text-[40px]">
        Dune
      </h1>
      <p className="mt-3 max-w-2xl text-base text-dim">
        Shareable SQL on <span className="num">monad_testnet</span> against Vessel
        contracts. Live hedge numbers stay on Transparency; this page is the
        public dashboard layer. See <span className="num">docs/DUNE.md</span>.
      </p>

      <Card className="mt-8 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="display text-lg">Overview</h2>
          <span className="num text-[10px] tracking-[0.1em] text-steel">SOURCE · DUNE</span>
        </div>
        {overview.status === "loading" ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : overview.status === "unavailable" ? (
          <p className="mt-4 text-sm">
            <Unavailable reason={overview.reason} />
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <Metric label="Cranks" value={overview.value.crank_events} />
            <Metric label="Waterfalls" value={overview.value.waterfall_events} />
            <Metric label="Joins" value={overview.value.join_events} />
            <Metric label="Deploys" value={overview.value.deploy_events} />
            <p className="num col-span-full text-[11px] text-steel">
              {overview.source} · chain {overview.value.chain_id} · {overview.value.dune_schema}
            </p>
          </div>
        )}
      </Card>

      <Card className="mt-6 p-5 sm:p-6">
        <h2 className="display text-lg">Dashboard</h2>
        {dashboard ? (
          <div className="mt-4 space-y-3">
            <a
              href={dashboard}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-purple underline"
            >
              Open on Dune ↗
            </a>
            <iframe
              title="Vessel Dune dashboard"
              src={dashboard}
              className="h-[480px] w-full rounded-[var(--radius-card)] border border-line bg-bg"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
            <p className="num text-[11px] text-steel">
              Embed only renders when you set a real published dashboard URL.
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm">
            <Unavailable reason="NEXT_PUBLIC_DUNE_DASHBOARD_URL unset — no embed until a published dashboard exists" />
          </p>
        )}
      </Card>

      <Card className="mt-6 p-5 sm:p-6">
        <h2 className="display text-lg">SQL templates</h2>
        <p className="mt-2 text-sm text-dim">
          Repo ships query SQL under <span className="num">dune/queries/</span>. Publish
          them on Dune, then wire env. Templates filter Vessel addresses from{" "}
          <span className="num">ADDRESSES.json</span>.
        </p>
        <ul className="num mt-4 list-disc space-y-1 pl-5 text-[12px] text-steel">
          <li>01_cranks.sql — daily Cranked counts</li>
          <li>02_waterfall.sql — Waterfall settles</li>
          <li>03_joins_exits.sql — Hull / Ballast flow</li>
          <li>04_overview.sql — single-row snapshot for this page</li>
        </ul>
        <p className="mt-4 text-sm">
          <Link href="/transparency" className="text-purple underline">
            Transparency →
          </Link>
          {" · "}
          <a
            href="https://docs.dune.com/data-catalog/evm/monad-testnet/raw/logs"
            className="text-purple underline"
            target="_blank"
            rel="noreferrer"
          >
            monad_testnet.logs ↗
          </a>
        </p>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-line bg-bg px-4 py-3">
      <p className="num text-[10px] tracking-[0.14em] text-steel">{label}</p>
      <p className="num mt-1 text-2xl text-phosphor">{value.toLocaleString()}</p>
    </div>
  );
}
