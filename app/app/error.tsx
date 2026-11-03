"use client";

/** Route-level boundary: a screen that throws keeps the app shell and the honesty banner around it. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-[720px] px-4 py-16 text-center sm:px-5">
      <p className="num text-[10.5px] tracking-[0.18em] text-amber">UNAVAILABLE</p>
      <h1 className="display mt-3 text-3xl font-bold">This screen could not be shown</h1>
      <p className="mt-3 text-sm text-dim">{error.message || "render failed"}</p>
      <button type="button" onClick={reset} className="num mt-8 min-h-11 text-[11px] uppercase tracking-[0.18em] text-hull">
        Try again
      </button>
    </div>
  );
}
