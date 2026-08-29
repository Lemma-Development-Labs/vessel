import Link from "next/link";

const STATES = [
  { q: "", label: "Default seeded book" },
  { q: "empty", label: "Empty — no user position" },
  { q: "disconnected", label: "Not connected" },
  { q: "negative", label: "Negative epoch waterfall" },
  { q: "error", label: "RPC reconnecting" },
  { q: "floor", label: "Ballast exit blocked by floor" },
  { q: "impair", label: "Hull impairment banner" },
  { q: "wrongnet", label: "Wrong network" },
  { q: "boarded", label: "User already boarded" },
];

export default function DemoStatesPage() {
  return (
    <div className="mx-auto max-w-[720px] px-5 py-12">
      <h1 className="display text-3xl font-bold">Demo states</h1>
      <p className="mt-2 text-sm text-dim">
        MockProvider variants via <span className="num">?demo=</span>. Use these for screenshots.
      </p>
      <ul className="mt-8 space-y-3">
        {STATES.map((s) => (
          <li key={s.q || "default"}>
            <Link className="text-purple" href={`/deposit${s.q ? `?demo=${s.q}` : ""}`}>
              {s.label}
            </Link>
            <span className="num ml-2 text-xs text-steel">
              {s.q ? `?demo=${s.q}` : "/deposit"}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-dim">
        Transparency negative:{" "}
        <Link href="/transparency?demo=negative" className="text-purple">
          /transparency?demo=negative
        </Link>
      </p>
    </div>
  );
}
