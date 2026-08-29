"use client";

import { useState, useSyncExternalStore } from "react";
import { useVessel } from "@/lib/context";
import { MONAD_FAUCET_URL, WC_ENABLED, isMobileUA } from "@/lib/wagmi";
import { Button, Card, Modal } from "@/components/ui";

/**
 * PHASE 3.1 / 3.3 — connecting, and onboarding someone who has never heard of
 * this project.
 *
 * Two things the old flow got wrong:
 *  1. Injected-only. On mobile Safari there is no injected provider, so the
 *     Connect button silently did nothing — and a link opened from a phone is
 *     how most strangers arrive.
 *  2. Gas ordering. The app pointed people at the dUSD faucet, but the dUSD
 *     faucet is itself a transaction. With no MON you cannot call it, so a new
 *     user hits a wall that never explains itself. MON comes first, always.
 */
/**
 * The UA is only knowable on the client, so the server snapshot is `false` and
 * the client re-renders with the real answer. `useSyncExternalStore` is the
 * sanctioned way to express that — an effect that calls setState would trigger
 * a cascading render (and is what `react-hooks/set-state-in-effect` flags).
 */
const noopSubscribe = () => () => {};

function useIsMobile(): boolean {
  return useSyncExternalStore(noopSubscribe, isMobileUA, () => false);
}

export function ConnectButton({ className = "" }: { className?: string }) {
  const v = useVessel();
  const [open, setOpen] = useState(false);
  const mobile = useIsMobile();

  if (v.connected) return null;

  // One wallet option and nothing to choose: connect directly.
  const single = v.connectors.length <= 1;

  return (
    <>
      <Button
        className={className}
        onClick={() => (single ? void v.connect() : setOpen(true))}
      >
        Connect
      </Button>
      <WalletPicker open={open} onClose={() => setOpen(false)} mobile={mobile} />
    </>
  );
}

function WalletPicker({
  open,
  onClose,
  mobile,
}: {
  open: boolean;
  onClose: () => void;
  mobile: boolean;
}) {
  const v = useVessel();

  // On a phone, WalletConnect is the option that actually works; put it first.
  // On desktop the injected wallet is one click, so it leads.
  const ordered = [...v.connectors].sort((a, b) => {
    const score = (id: string) => {
      const isWc = id.toLowerCase().includes("walletconnect");
      if (mobile) return isWc ? 0 : 1;
      return isWc ? 1 : 0;
    };
    return score(a.id) - score(b.id);
  });

  return (
    <Modal open={open} title="Connect a wallet" onClose={onClose}>
      <div className="flex flex-col gap-2">
        {ordered.map((c) => {
          const isWc = c.id.toLowerCase().includes("walletconnect");
          return (
            <Button
              key={c.id}
              variant="ghost"
              className="w-full justify-between"
              onClick={() => {
                void v.connect(c.id);
                onClose();
              }}
            >
              <span>{isWc ? "WalletConnect" : c.name}</span>
              <span className="num text-[10px] tracking-[0.14em] text-steel">
                {isWc ? (mobile ? "RECOMMENDED" : "MOBILE / QR") : "BROWSER"}
              </span>
            </Button>
          );
        })}
      </div>

      {!WC_ENABLED ? (
        <p className="num mt-4 rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-[11px] leading-relaxed text-amber">
          WalletConnect is not configured on this deployment
          (NEXT_PUBLIC_WC_PROJECT_ID is unset), so only a browser-extension
          wallet will work here. On a phone, that usually means no wallet at all.
        </p>
      ) : null}

      <p className="mt-4 text-sm text-dim">
        You&apos;ll need testnet MON for gas before anything else — including the
        dUSD faucet, which is itself a transaction.
      </p>
      <a
        href={MONAD_FAUCET_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="num mt-2 inline-block text-[12px] text-purple"
      >
        Get testnet MON from the Monad faucet ↗
      </a>
    </Modal>
  );
}

/**
 * First-run guidance shown once a wallet is connected but has no gas. This is
 * the step that silently blocks new users, so it gets its own card rather than
 * a tooltip.
 */
export function GasFirstCard({ className = "" }: { className?: string }) {
  const v = useVessel();
  if (!v.connected) return null;

  // Only shown when we know the user has no dUSD — if the read failed we do
  // not guess at their state.
  const noDusd = v.dusdBalance.status === "ok" && v.dusdBalance.value === 0n;
  if (!noDusd) return null;

  return (
    <Card className={`border-amber/30 p-5 ${className}`}>
      <p className="num text-[10.5px] tracking-[0.16em] text-amber">START HERE</p>
      <p className="display mt-2 text-lg">Two faucets, in this order</p>
      <ol className="mt-3 space-y-2 text-sm text-dim">
        <li>
          <span className="num text-steel">1.</span>{" "}
          <a
            href={MONAD_FAUCET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple"
          >
            Testnet MON for gas ↗
          </a>{" "}
          — every transaction needs it, including step 2.
        </li>
        <li>
          <span className="num text-steel">2.</span> Then &ldquo;Get test dollars&rdquo; above for
          100 dUSD to deposit.
        </li>
      </ol>
    </Card>
  );
}
