/**
 * Poll the short-manager keeper's health endpoints.
 *
 * Prefer NEXT_PUBLIC_KEEPER_URL (Railway vessel-service / keeper). Falls back
 * to unavailable — never invents a "running" state.
 */

export type KeeperDecisionSnapshot = {
  at: number;
  kind: string;
  reason: string;
  dryRun: boolean;
  orderId?: string | number;
  note?: string;
  source?: "CRE" | "keeper";
};

export type KeeperHealth = {
  ok: boolean;
  detail: string;
  uptimeMs?: number;
  lastDecision: KeeperDecisionSnapshot | null;
  source: string;
  creHaltLatched?: boolean;
};

export function keeperBaseUrl(): string | undefined {
  const u = process.env.NEXT_PUBLIC_KEEPER_URL?.trim();
  return u && u.length > 0 ? u.replace(/\/$/, "") : undefined;
}

function asDecision(raw: unknown): KeeperDecisionSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const decision = d.decision;
  if (!decision || typeof decision !== "object") return null;
  const kind = (decision as { kind?: unknown }).kind;
  const reason = (decision as { reason?: unknown }).reason;
  if (typeof kind !== "string" || typeof reason !== "string") return null;
  const at = typeof d.at === "number" ? d.at : Date.now();
  const src = d.source;
  return {
    at,
    kind,
    reason,
    dryRun: Boolean(d.dryRun),
    orderId:
      typeof d.orderId === "string" || typeof d.orderId === "number" ? d.orderId : undefined,
    note: typeof d.note === "string" ? d.note : undefined,
    source: src === "CRE" || src === "keeper" ? src : undefined,
  };
}

export async function fetchKeeperHealth(
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: "ok"; value: KeeperHealth } | { status: "unavailable"; reason: string }> {
  const base = keeperBaseUrl();
  if (!base) {
    return {
      status: "unavailable",
      reason: "NEXT_PUBLIC_KEEPER_URL unset — keeper health not configured",
    };
  }
  try {
    const res = await fetchImpl(`${base}/health`, { cache: "no-store" });
    if (!res.ok) {
      return {
        status: "unavailable",
        reason: `keeper /health HTTP ${res.status}`,
      };
    }
    const body = (await res.json()) as Record<string, unknown>;
    return {
      status: "ok",
      value: {
        ok: Boolean(body.ok),
        detail: typeof body.detail === "string" ? body.detail : "no detail",
        uptimeMs: typeof body.uptimeMs === "number" ? body.uptimeMs : undefined,
        lastDecision: asDecision(body.lastDecision),
        source: `${base}/health`,
        creHaltLatched: Boolean(body.creHaltLatched),
      },
    };
  } catch (err) {
    return {
      status: "unavailable",
      reason: `keeper unreachable — ${err instanceof Error ? err.message : "network error"}`,
    };
  }
}
