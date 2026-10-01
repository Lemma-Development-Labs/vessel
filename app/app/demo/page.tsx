import Link from "next/link";

const STATES = [
  { q: "", label: "Seeded book — open series, positions, an exit cooling, claims ready" },
  { q: "unwired", label: "Freshly deployed — empty book, no engine, no series (today's testnet)" },
  { q: "empty", label: "Connected, no positions yet" },
  { q: "notinvited", label: "Wallet not on the beta allowlist" },
  { q: "disconnected", label: "Not connected" },
  { q: "paused", label: "Guardian paused deposits" },
  { q: "impair", label: "Hull impairment banner" },
  { q: "error", label: "RPC reconnecting" },
  { q: "wrongnet", label: "Wrong network" },
];

const ROUTES = ["/deposit", "/portfolio", "/withdraw", "/series", "/transparency"];

export default function DemoStatesPage() {
  return (
    <div className="mx-auto max-w-[720px] px-4 py-10 sm:px-5 md:py-12">
      <h1 className="display text-3xl font-bold">Demo states</h1>
      <p className="mt-2 text-sm text-dim">
        Mock provider variants via <span className="num">?demo=</span> (needs <span className="num">NEXT_PUBLIC_USE_MOCK=1</span>).
        Use these for screenshots.
      </p>
      <ul className="mt-8 space-y-4">
        {STATES.map((s) => (
          <li key={s.q || "default"}>
            <p>{s.label}</p>
            <p className="mt-1 flex flex-wrap gap-3">
              {ROUTES.map((r) => (
                <Link key={r} className="num text-xs text-purple" href={`${r}${s.q ? `?demo=${s.q}` : ""}`}>
                  {r}
                </Link>
              ))}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
