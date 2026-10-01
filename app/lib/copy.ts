/** Fixed user-facing copy (app/CLAUDE.md "Copy (do not paraphrase)"). */
export const COPY = {
  floor: "Ballast must stay at or above 20% of deck TVL. Join Ballast or exit Hull.",
  hullFull: "Hull is full for now — Ballast capacity must grow first (20% floor)",
  ballastExit:
    "Exit queued by the floor — Ballast is what protects Hull. Capacity frees as Hull exits or Ballast grows.",
  cooldown: (s: number) => {
    const m = Math.floor(Math.max(0, s) / 60);
    const r = Math.max(0, s) % 60;
    return `Faucet cooldown — ${m}:${r.toString().padStart(2, "0")} remaining`;
  },
  impair: "HULL IMPAIRMENT — halted",
  slippage: "price moved — try again",
  legal: "Unaudited testnet. Demo dollars (dUSD) have no value. Not an offer of securities.",
} as const;

export type Toast = {
  id: string;
  kind: "pending" | "success" | "error" | "info";
  text: string;
  href?: string;
};
