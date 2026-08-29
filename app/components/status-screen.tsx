"use client";

import { useQuery } from "@tanstack/react-query";
import { statsUrl } from "@/lib/stats";
import { Card } from "@/components/ui";

/**
 * PHASE 4.3 — public status.
 *
 * A protocol whose brand is verifiability should publish its own uptime. This
 * page reads the hosted service's /health and renders it as-is, including the
 * parts that are broken. It never substitutes a zero or a green tick for
 * something it could not read: an unreachable service says so, and a 503 from
 * the service is rendered as a real answer rather than swallowed as an error.
 */

type Health = {
  ok?: boolean;
  degraded?: string[];
  service?: { version?: string; uptimeSec?: number; db?: string; chainId?: number; venue?: string };
  rpc?: { ok?: boolean; blockNumber?: string | null };
  keeper?: {
    configured?: boolean;
    running?: boolean;
    address?: string | null;
    balanceMon?: string | null;
    gasLimit?: string | null;
    gasPriceGwei?: string | null;
    costPerCrankMon?: string | null;
    cranksRemaining?: number | null;
    minCranksRunway?: number | null;
    stuckTxHash?: string | null;
  };
  indexer?: {
    running?: boolean;
    confirmations?: number;
    cursor?: string | null;
    safeHead?: string | null;
    head?: string | null;
    lagBlocks?: number | null;
  };
  protocol?: {
    lastCrankTs?: number | null;
    secondsSinceLastCrank?: number | null;
    netDeltaPct?: number | null;
  };
  errors?: Record<string, string>;
};

export function StatusScreen() {
  const url = statsUrl();

  const q = useQuery({
    queryKey: ["status", url],
    enabled: Boolean(url),
    refetchInterval: 15_000,
    retry: 1,
    queryFn: async (): Promise<{ status: number; body: Health }> => {
      const res = await fetch(`${url}/health`, { cache: "no-store" });
      // A 503 is a real answer, not a failure — the service is telling us it is
      // degraded and exactly why, so we render that rather than an error state.
      const body = (await res.json().catch(() => ({}))) as Health;
      return { status: res.status, body };
    },
  });

  return (
    <div className="mx-auto max-w-[860px] px-4 py-10 sm:px-5 md:py-14">
      <p className="num text-[10.5px] tracking-[0.18em] text-steel">STATUS</p>
      <h1 className="display mt-3 text-[28px] font-bold leading-[1.04] tracking-[-0.02em] sm:text-[36px]">
        What is actually running
      </h1>
      <p className="mt-3 max-w-xl text-base text-dim">
        Read live from the hosted service. Anything we can&apos;t read shows as{" "}
        <span className="num text-steel/60">—</span>, never as a zero and never as a green tick.
      </p>

      {!url ? (
        <Card className="mt-8 border-amber/30 p-5">
          <p className="num text-[10.5px] tracking-[0.16em] text-amber">NOT CONFIGURED</p>
          <p className="mt-2 text-sm text-ink">
            No stats service is configured for this deployment (
            <span className="num">NEXT_PUBLIC_STATS_URL</span> is unset), so there is no keeper or
            indexer to report on. The app reads history directly from the RPC, which serves only a
            limited window.
          </p>
        </Card>
      ) : q.isLoading ? (
        <Card className="mt-8 p-5">
          <p className="num text-sm text-steel">Reading {url}/health …</p>
        </Card>
      ) : q.isError || !q.data ? (
        <Card className="mt-8 border-red/40 p-5">
          <p className="num text-[10.5px] tracking-[0.16em] text-red">UNREACHABLE</p>
          <p className="mt-2 text-sm text-ink">
            The stats service at <span className="num">{url}</span> did not answer. The keeper and
            indexer may be down; this page cannot tell you which.
          </p>
        </Card>
      ) : (
        <Report url={url} status={q.data.status} h={q.data.body} />
      )}

      <p className="mt-8 text-sm text-dim">
        The app&apos;s own <span className="num">/health</span> is a liveness probe for the web
        process only — it says nothing about the protocol.
      </p>
    </div>
  );
}

function Report({ url, status, h }: { url: string; status: number; h: Health }) {
  const healthy = status === 200 && h.ok === true;
  const degraded = h.degraded ?? [];
  const err = h.errors ?? {};

  return (
    <>
      <Card className={`mt-8 p-5 ${healthy ? "border-phosphor/40" : "border-red/40"}`}>
        <p className={`num text-[10.5px] tracking-[0.16em] ${healthy ? "text-phosphor" : "text-red"}`}>
          {healthy ? "OPERATIONAL" : "DEGRADED"}
        </p>
        <p className="num mt-2 break-all text-[11.5px] text-steel">
          {url}/health → HTTP {status}
        </p>
        {degraded.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm text-red">
            {degraded.map((d) => (
              <li key={d}>· {d}</li>
            ))}
          </ul>
        ) : null}
      </Card>

      <h2 className="display mt-8 text-lg">Keeper</h2>
      <div className="mt-3 grid gap-px overflow-hidden rounded-2xl border border-line sm:grid-cols-2">
        <Row
          label="LAST CRANK"
          v={fmtAgo(h.protocol?.secondsSinceLastCrank)}
          err={err.lastCrank}
        />
        <Row label="MON BALANCE" v={h.keeper?.balanceMon ? `${h.keeper.balanceMon} MON` : null} err={err.keeperBalance} />
        <Row
          label="GAS RUNWAY"
          v={
            h.keeper?.cranksRemaining != null
              ? `${h.keeper.cranksRemaining} cranks${h.keeper.minCranksRunway != null ? ` (min ${h.keeper.minCranksRunway})` : ""}`
              : null
          }
          err={h.keeper?.configured === false ? "keeper not configured" : undefined}
          hint="Computed from the gas LIMIT. Monad charges the limit, not usage, so budgeting on historical usage under-counts."
        />
        <Row
          label="COST PER CRANK"
          v={
            h.keeper?.costPerCrankMon
              ? `${h.keeper.costPerCrankMon} MON${h.keeper.gasPriceGwei ? ` @ ${h.keeper.gasPriceGwei} gwei` : ""}`
              : null
          }
          err={h.keeper?.configured === false ? "keeper not configured" : undefined}
        />
      </div>
      {h.keeper?.stuckTxHash ? (
        <p className="num mt-2 break-all text-[11.5px] text-red">
          stuck crank tx: {h.keeper.stuckTxHash}
        </p>
      ) : null}

      <h2 className="display mt-8 text-lg">Indexer &amp; chain</h2>
      <div className="mt-3 grid gap-px overflow-hidden rounded-2xl border border-line sm:grid-cols-2">
        <Row
          label="INDEXER LAG"
          v={h.indexer?.lagBlocks != null ? `${h.indexer.lagBlocks} blocks` : null}
          hint="safe head minus persisted cursor"
        />
        <Row label="CURSOR" v={h.indexer?.cursor ? `#${h.indexer.cursor}` : null} />
        <Row
          label="CONFIRMATIONS"
          v={h.indexer?.confirmations != null ? `${h.indexer.confirmations} blocks behind head` : null}
        />
        <Row label="RPC HEAD" v={h.rpc?.blockNumber ? `#${h.rpc.blockNumber}` : null} err={err.blockNumber} />
        <Row
          label="NET DELTA"
          v={h.protocol?.netDeltaPct != null ? `${h.protocol.netDeltaPct.toFixed(2)}%` : null}
          err={err.netDeltaBps}
        />
        <Row
          label="STORE"
          v={h.service?.db ?? null}
          hint="memory means history is lost on restart"
        />
      </div>

      <p className="num mt-4 text-[11px] text-steel">
        service {h.service?.version ?? "—"} · chain {h.service?.chainId ?? "—"} · venue{" "}
        {h.service?.venue ?? "—"} · up {fmtAgo(h.service?.uptimeSec) ?? "—"}
      </p>
    </>
  );
}

function Row({
  label,
  v,
  err,
  hint,
}: {
  label: string;
  v: string | null | undefined;
  err?: string | null;
  hint?: string;
}) {
  return (
    <div className="bg-bg2 px-5 py-4">
      <p className="num text-[10px] tracking-[0.16em] text-steel" title={hint}>
        {label}
      </p>
      <p className="num mt-1 break-all text-lg">
        {v != null ? (
          v
        ) : (
          <span className="cursor-help text-steel/60" title={err ?? "not reported by the service"}>
            —
          </span>
        )}
      </p>
    </div>
  );
}

function fmtAgo(sec: number | null | undefined): string | null {
  if (sec == null) return null;
  if (sec < 90) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}
