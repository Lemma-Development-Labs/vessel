import Link from "next/link";

/** Series terms surface — coupon math lives in docs until secondary market ships. */
export default function SeriesPage() {
  return (
    <div className="mx-auto max-w-[720px] px-4 py-10 sm:px-5 md:py-14">
      <p className="num text-[10.5px] tracking-[0.18em] text-steel">SERIES</p>
      <h1 className="display mt-3 text-[32px] font-bold tracking-[-0.02em] sm:text-[40px]">
        Series-001
      </h1>
      <p className="mt-3 text-base text-dim">
        Hull coupon is a published parameter (never “APY”). Testnet underlying under
        consideration is <span className="num text-ink">MON</span> only. Secondary market
        and HullSeries listing stay gated until{" "}
        <span className="num">TX_KURU_SPOT</span> and{" "}
        <span className="num">PERPL_KEEPER_ORDER</span> are real hashes in{" "}
        <span className="num">docs/ADDRESSES.md</span>.
      </p>
      <ul className="mt-8 space-y-3 text-sm text-dim">
        <li>Loss routing: Ballast → reserve; impairment reverts rather than haircutting Hull.</li>
        <li>Subordination floor: Ballast ≥ 20% of deck TVL or Hull mint reverts.</li>
        <li>
          Full terms:{" "}
          <a className="text-purple underline" href="https://docs.vessel.wtf">
            docs.vessel.wtf
          </a>{" "}
          · repo <span className="num">docs/series/001.md</span>
        </li>
      </ul>
      <p className="mt-8">
        <Link href="/transparency" className="text-sm text-purple underline">
          Transparency →
        </Link>
        {" · "}
        <Link href="/deposit" className="text-sm text-purple underline">
          Deposit →
        </Link>
      </p>
    </div>
  );
}
