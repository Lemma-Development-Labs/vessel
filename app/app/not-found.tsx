import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[720px] px-4 py-16 text-center sm:px-5">
      <p className="num text-[10.5px] tracking-[0.18em] text-steel">404</p>
      <h1 className="display mt-3 text-3xl font-bold">No such deck</h1>
      <p className="mt-3 text-sm text-dim">That route is not on this testnet app.</p>
      <p className="mt-8">
        <Link href="/deposit" className="text-purple">
          Board a deck
        </Link>
      </p>
    </div>
  );
}
