"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";

const KEY = "vessel.firstRun.dismissed.v1";

/**
 * Three lines, then get out of the way. Not a marketing modal.
 */
export function FirstRunOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      if (window.localStorage.getItem(KEY) === "1") return;
      setOpen(true);
    } catch {
      /* private mode — skip */
    }
  }, []);

  if (!open) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-title"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4 sm:items-center"
    >
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-bg2 p-6 shadow-none">
        <p className="num text-[10px] tracking-[0.16em] text-amber">FIRST RUN</p>
        <h2 id="first-run-title" className="display mt-2 text-xl text-ink">
          Vessel on Monad testnet
        </h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-dim">
          <li>
            Engine + Hull + Ballast + vUSD/svUSD (coming up) + Proof-of-Hedge — demo dollars,{" "}
            <strong className="font-medium text-ink">no value</strong>, unaudited.
          </li>
          <li>
            Get MON from the{" "}
            <a
              className="text-purple underline"
              href="https://faucet.monad.xyz"
              target="_blank"
              rel="noreferrer"
            >
              Monad faucet
            </a>
            , then use <span className="num">Get test dollars</span> on Deposit for dUSD.
          </li>
          <li>
            Board <span className="text-brass">Ballast</span> before Hull when the floor is short.
            Unwind is always on the action strip — anyone can call it.
          </li>
        </ol>
        <Button className="mt-6 w-full" onClick={dismiss}>
          Got it
        </Button>
      </div>
    </div>
  );
}
