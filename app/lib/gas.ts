export const MIN_JOIN = 1_000_000n; // 1 dUSD, matches Tranches.MIN_JOIN

/**
 * MONAD CHARGES THE GAS LIMIT, NOT GAS USED.
 *
 *   gas_paid = gas_limit * price_per_gas
 *
 * (.agents/skills/gas/SKILL.md). So an inflated limit is not a harmless safety
 * margin — it is a direct overcharge on every user, every transaction. The
 * skill's guidance is a buffer of at most 10% over a real estimate.
 *
 * The previous constants were 3–10x measured cost. Measured against the live
 * testnet deployment with eth_estimateGas:
 *
 *   crank()            127,425      (was capped at 1,300,000 — 10.2x)
 *   deployLiquidity()  469,430      (was 1,500,000 — 3.2x)
 *   unwind()           121,989      (had no limit at all)
 *   faucet()           121,347      (was 200,000)
 *   approve()           52,114      (was 80,000)
 *
 * Foundry --gas-report maxima across the whole suite (worst-case paths that
 * the live estimates above could not reach, because the testnet vault has no
 * position open right now):
 *
 *   crank 237,917 · deployLiquidity 356,148 · unwind 224,715
 *   joinHull 167,393 · joinBallast 210,672 · exitHull 96,961 · exitBallast 97,159
 *
 * Foundry understates Monad: Monad reprices COLD state access upward (cold
 * SLOAD 8,100 vs 2,100; cold account 10,100 vs 2,600). Warm access is
 * unchanged. Cold-heavy paths therefore cost meaningfully more on Monad than
 * a foundry number suggests.
 *
 * So: estimate at call time and add 10% (`bufferGas`). These constants are
 * only the CEILING used when estimation is impossible — set from the foundry
 * worst case plus generous headroom for Monad's cold-access repricing. A
 * too-tight ceiling is worse than a loose one: an out-of-gas transaction still
 * pays the full limit and accomplishes nothing.
 */
export const GAS_CEILING = {
  faucet: 200_000n,
  approve: 90_000n,
  join: 420_000n,
  exit: 200_000n,
  crank: 550_000n,
  deployLiquidity: 2_500_000n, // CLOB path is heavier than MockRouter; estimate still preferred
  unwind: 2_000_000n,
} as const;

/** Back-compat alias; prefer GAS_CEILING so the semantics are explicit. */
export const GAS = GAS_CEILING;

/** The skill's maximum recommended buffer over a real estimate. */
export const GAS_BUFFER_PCT = 10n;

export function bufferGas(estimate: bigint, ceiling: bigint): bigint {
  if (estimate <= 0n) return ceiling;
  const buffered = estimate + (estimate * GAS_BUFFER_PCT) / 100n;
  return buffered > ceiling ? ceiling : buffered;
}

/**
 * Estimate, buffer by 10%, and fall back to the ceiling if the node cannot
 * estimate (usually because the call would revert — in which case the wallet
 * would otherwise substitute its own, much larger, default limit).
 */
export async function gasFor(
  estimateFn: () => Promise<bigint>,
  ceiling: bigint,
): Promise<bigint> {
  try {
    return bufferGas(await estimateFn(), ceiling);
  } catch {
    return ceiling;
  }
}
