/**
 * The environment banner (spec §15, master prompt 1.6). It is derived, never
 * hand-written per page, so it cannot drift from the chain the app targets.
 *
 * - Testnet: "TESTNET · NO REAL VALUE · <actual review status>".
 * - Mainnet: "PRIVATE MAINNET BETA · REAL FUNDS AT RISK · <review scope + date>".
 *   A no-real-value banner must never appear on mainnet, and a mainnet build
 *   without a stated review scope is refused rather than given a vague label.
 */

/** The actual independent-review status today (gate G05 / R05): none performed. */
export const TESTNET_REVIEW_STATUS = "NO INDEPENDENT REVIEW";

export type BannerTone = "testnet" | "mainnet";

export interface NetworkBanner {
  tone: BannerTone;
  text: string;
}

export function networkBanner(chainId: number, reviewStatus: string | undefined): NetworkBanner {
  if (chainId === 143) {
    const scope = reviewStatus?.trim();
    if (!scope) {
      throw new Error("mainnet banner requires the review scope and date (NEXT_PUBLIC_REVIEW_STATUS)");
    }
    return { tone: "mainnet", text: `PRIVATE MAINNET BETA · REAL FUNDS AT RISK · ${scope}` };
  }
  const label = chainId === 31337 ? "LOCAL" : "TESTNET";
  return { tone: "testnet", text: `${label} · NO REAL VALUE · ${reviewStatus?.trim() || TESTNET_REVIEW_STATUS}` };
}
