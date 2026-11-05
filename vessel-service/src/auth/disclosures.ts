/**
 * Versioned participant disclosures (spec §14, §19). The app renders the
 * text the service returns; acceptance records the version AND the SHA-256
 * of the exact text shown, so a changed text needs a new version.
 *
 * This is the testnet disclosure. It is not legal terms: counsel-reviewed
 * participation terms are gate G06 and are required before any mainnet
 * invitation. Never reuse a testnet version on mainnet.
 */
export interface Disclosure {
  version: string;
  environment: "local" | "testnet" | "mainnet";
  text: string;
}

export const TESTNET_DISCLOSURE: Disclosure = {
  version: "2026-09-30.testnet.1",
  environment: "testnet",
  text: [
    "TESTNET · NO REAL VALUE · NO INDEPENDENT SECURITY REVIEW YET",
    "",
    "Vessel on Monad testnet uses demo dollars (dUSD) that have no value, a simulated short venue and a mock spot router. Nothing you do here earns or risks real money.",
    "",
    "Signing in proves you control this wallet. It does not authorize any spending: every deposit, exit or claim is a separate transaction you approve in your wallet.",
    "",
    "Redeeming an invitation records your wallet as a beta participant for research and support. It is not on-chain admission, and it does not reserve capacity in any future mainnet beta.",
    "",
    "In the planned mainnet product, Hull is a 28-day senior claim with a fixed contractual rate that is subject to loss and is not guaranteed; Ballast absorbs losses first and can lose its entire value; exits take time and depend on available liquidity.",
    "",
    "We keep your wallet address, invitation, consent version and timestamps. We do not ask for seed phrases or private keys, ever.",
  ].join("\n"),
};

export function currentDisclosure(environment: Disclosure["environment"]): Disclosure {
  if (environment === "mainnet") {
    // G06: counsel-reviewed mainnet terms do not exist yet. Refuse rather
    // than show testnet copy to mainnet users.
    throw new Error("no mainnet disclosure is approved (gate G06)");
  }
  return TESTNET_DISCLOSURE;
}
