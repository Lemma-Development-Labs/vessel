/**
 * Pure policy — state → Decision. No I/O. Shared with CRE workflow later.
 */
import type { Decision, KeeperState } from "./types.ts";

const BPS = 10_000n;

export function decide(s: KeeperState): Decision {
  if (s.killSwitch) {
    return { kind: "halt", reason: "kill switch file present" };
  }
  if (s.gasBudgetWei < s.minGasBudgetWei) {
    return { kind: "halt", reason: `gas runway ${s.gasBudgetWei} < min ${s.minGasBudgetWei} (budget on gas_limit)` };
  }
  if (s.marketDataAgeMs > s.maxMarketDataAgeMs) {
    return { kind: "halt", reason: `stale market data ageMs=${s.marketDataAgeMs}` };
  }
  if (s.capUtilisationBps > 10_000) {
    return { kind: "halt", reason: `cap breach utilBps=${s.capUtilisationBps}` };
  }

  const absDelta = s.netDeltaBps < 0 ? -s.netDeltaBps : s.netDeltaBps;
  if (absDelta > s.deviationBandBps) {
    // Need exit depth at least equal to the overhang we would reduce.
    const overhang =
      s.spotValueQuote > s.perplShortNotional
        ? s.spotValueQuote - s.perplShortNotional
        : s.perplShortNotional - s.spotValueQuote;
    if (s.exitDepthQuote < overhang && overhang > 0n) {
      return {
        kind: "halt",
        reason: `deviation ${absDelta}bps > band ${s.deviationBandBps}; exit depth ${s.exitDepthQuote} < overhang ${overhang}`,
      };
    }
    const target =
      overhang > s.maxNotionalPerAction ? s.maxNotionalPerAction : overhang;
    // Prefer reduce toward matching the smaller of spot/short toward balance.
    return {
      kind: "reduce",
      targetNotional: target,
      reason: `deviation ${absDelta}bps outside band ${s.deviationBandBps}`,
    };
  }

  // Funding sign flip beyond threshold (micros): 50 bps of interval ≈ 5000 micros.
  const flipThresh = 5_000;
  if (
    s.prevFundingRateMicros !== 0 &&
    Math.sign(s.fundingRateMicros) !== Math.sign(s.prevFundingRateMicros) &&
    Math.abs(s.fundingRateMicros - s.prevFundingRateMicros) > flipThresh
  ) {
    return {
      kind: "halt",
      reason: `funding sign flip ${s.prevFundingRateMicros}→${s.fundingRateMicros}`,
    };
  }

  if (s.headBlock > s.lastCrankBlock + s.crankIntervalBlocks) {
    return {
      kind: "crank",
      reason: `crank due head=${s.headBlock} last=${s.lastCrankBlock} interval=${s.crankIntervalBlocks}`,
    };
  }

  void BPS;
  return { kind: "noop", reason: "within band; crank not due" };
}
