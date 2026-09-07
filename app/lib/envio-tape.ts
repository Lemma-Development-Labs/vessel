import { ok, unavailable, type Live } from "./live";

/**
 * Envio HyperIndex crank tape.
 *
 * Architectural note (bounty write-up): Monad full nodes drop arbitrary
 * historical state. Every historical series Vessel shows — crank tape, funding
 * accrual, NAV, delta over time — cannot come from an archive RPC. The indexer
 * is not decoration; without it Transparency can only show "now".
 *
 * Bounty condition: this path is GraphQL-only. Never fall back to keeper JSON.
 */

export type CrankTapeRow = {
  block: bigint;
  ts: bigint;
  actor: string;
  decision: string;
  gasLimit: bigint;
  deltaBefore: bigint;
  deltaAfter: bigint;
  txHash: string;
};

/** Canonical query — matches indexer/schema.graphql `Crank`. */
export const CRANK_TAPE_QUERY = `
query CrankTape($limit: Int!) {
  Crank(order_by: { block: desc }, limit: $limit) {
    block
    ts
    actor
    decision
    gasLimit
    deltaBefore
    deltaAfter
    txHash
  }
}
`;

export function envioGraphqlUrl(): string | undefined {
  const u = process.env.NEXT_PUBLIC_ENVIO_GRAPHQL?.trim();
  return u && u.length > 0 ? u : undefined;
}

function asBig(v: unknown): bigint | null {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  return null;
}

function parseRow(raw: Record<string, unknown>): CrankTapeRow | null {
  const block = asBig(raw.block);
  const ts = asBig(raw.ts);
  const gasLimit = asBig(raw.gasLimit);
  const deltaBefore = asBig(raw.deltaBefore);
  const deltaAfter = asBig(raw.deltaAfter);
  if (
    block === null ||
    ts === null ||
    gasLimit === null ||
    deltaBefore === null ||
    deltaAfter === null ||
    typeof raw.actor !== "string" ||
    typeof raw.decision !== "string" ||
    typeof raw.txHash !== "string"
  ) {
    return null;
  }
  return {
    block,
    ts,
    actor: raw.actor,
    decision: raw.decision,
    gasLimit,
    deltaBefore,
    deltaAfter,
    txHash: raw.txHash,
  };
}

/**
 * Sync snapshot for tests / SSR without a network. Returns unavailable when
 * the GraphQL endpoint is unset — never synthesises zeros or keeper JSON.
 */
export function crankTapeLive(): Live<CrankTapeRow[]> {
  const url = envioGraphqlUrl();
  if (!url) {
    return unavailable(
      "Envio crank tape — unavailable: NEXT_PUBLIC_ENVIO_GRAPHQL unset. Hosted HyperIndex endpoint goes in docs/ADDRESSES.md after deploy.",
    );
  }
  return unavailable(
    "Envio crank tape — use fetchCrankTape() for the live GraphQL read; sync path stays unavailable so we never invent rows.",
  );
}

/**
 * Fetch the crank tape from HyperIndex GraphQL.
 * On any failure → `unavailable` (never an empty array that looks like "zero cranks").
 */
export async function fetchCrankTape(limit = 32): Promise<Live<CrankTapeRow[]>> {
  const url = envioGraphqlUrl();
  if (!url) {
    return unavailable(
      "Envio crank tape — unavailable: NEXT_PUBLIC_ENVIO_GRAPHQL unset. See indexer/README.md.",
    );
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: CRANK_TAPE_QUERY, variables: { limit } }),
      // Browser + RSC: avoid stale CDN caches for a live tape.
      cache: "no-store",
    });
    if (!res.ok) {
      return unavailable(
        `Envio crank tape — unavailable: GraphQL HTTP ${res.status} from HyperIndex`,
      );
    }
    const body = (await res.json()) as {
      data?: { Crank?: unknown };
      errors?: { message?: string }[];
    };
    if (body.errors?.length) {
      return unavailable(
        `Envio crank tape — unavailable: GraphQL error — ${body.errors[0]?.message ?? "unknown"}`,
      );
    }
    const rows = body.data?.Crank;
    if (!Array.isArray(rows)) {
      return unavailable(
        "Envio crank tape — unavailable: GraphQL response missing Crank[] (indexer down or schema mismatch)",
      );
    }
    const parsed: CrankTapeRow[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") {
        return unavailable(
          "Envio crank tape — unavailable: malformed Crank row (refusing partial tape)",
        );
      }
      const p = parseRow(row as Record<string, unknown>);
      if (!p) {
        return unavailable(
          "Envio crank tape — unavailable: Crank row failed field parse (refusing partial tape)",
        );
      }
      parsed.push(p);
    }
    // Empty array after a healthy GraphQL response is legitimate (no cranks yet).
    return ok(parsed, "stats", Math.floor(Date.now() / 1000));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return unavailable(`Envio crank tape — unavailable: ${msg}`);
  }
}
