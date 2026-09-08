"use client";

/**
 * Honesty chips — flip only when ADDRESSES.md shipped hashes exist.
 * Never imply Kuru / Perpl / Envio / CRE live without a backing hash.
 */
import { ADDRESSES } from "@/lib/addresses";

/** Mirrors docs/ADDRESSES.md # Shipped hashes — update when real hashes land. */
export const SHIPPED = {
  TX_KURU_SPOT: false,
  PERPL_KEEPER_ORDER: false,
  ENVIO_GRAPHQL: Boolean(
    typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_ENVIO_GRAPHQL?.trim(),
  ),
  DUNE_DASHBOARD: Boolean(
    typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_DUNE_DASHBOARD_URL?.trim(),
  ),
  CRE_DON: false,
  VUSD_MINT: false,
} as const;

function Chip({
  label,
  ok,
  pending,
}: {
  label: string;
  ok: boolean;
  pending: string;
}) {
  return (
    <span
      className={`num inline-flex items-center rounded-[5px] border px-2 py-0.5 text-[10px] tracking-[0.08em] ${
        ok
          ? "border-phosphor/40 text-phosphor"
          : "border-white/12 text-steel"
      }`}
      title={ok ? label : pending}
    >
      {ok ? label : pending}
    </span>
  );
}

export function IntegrationChips({ className = "" }: { className?: string }) {
  const assetLabel = `asset: DemoUSD ${ADDRESSES.DemoUSD.slice(0, 6)}… (not Kuru USDC)`;
  return (
    <div className={`flex flex-wrap items-center justify-center gap-1.5 ${className}`}>
      <Chip
        label="spot: Kuru ✓"
        ok={SHIPPED.TX_KURU_SPOT}
        pending="spot: MockRouter (Kuru coming up)"
      />
      <Chip
        label="short: Perpl ✓"
        ok={SHIPPED.PERPL_KEEPER_ORDER}
        pending="short: SimVenue (Perpl coming up)"
      />
      <Chip
        label="Envio tape ✓"
        ok={SHIPPED.ENVIO_GRAPHQL}
        pending="Envio: coming up"
      />
      <Chip
        label="Dune ✓"
        ok={SHIPPED.DUNE_DASHBOARD}
        pending="Dune: SQL ready, dashboard pending"
      />
      <Chip
        label="CRE DON ✓"
        ok={SHIPPED.CRE_DON}
        pending="CRE: simulate only"
      />
      <Chip
        label="vUSD live"
        ok={SHIPPED.VUSD_MINT}
        pending="vUSD: coming up on testnet"
      />
      <span className="num text-[10px] tracking-[0.06em] text-steel">{assetLabel}</span>
    </div>
  );
}
