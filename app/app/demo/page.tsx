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
  { q: "undeployed", label: "Hedge not deployed yet" },
];

export default function DemoStatesPage() {
  return (
    <div className="mx-auto max-w-[720px] px-4 py-10 sm:px-5 md:py-12">
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
      <p className="mt-2 text-sm text-dim">
        Transparency undeployed:{" "}
        <Link href="/transparency?demo=undeployed" className="text-purple">
          /transparency?demo=undeployed
        </Link>
      </p>
    </div>
  );
}
