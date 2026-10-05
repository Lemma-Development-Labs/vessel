import { RELEASE, V2 } from "./release";

/**
 * The book's asset, from the release manifest (ADR-009). Deployments from ADR-009 on hold
 * Circle testnet USDC, which testers get from Circle's public faucet. The earlier testnet book
 * holds dUSD, Vessel's valueless demo token with an on-chain faucet. Every label, faucet and
 * approval in the app reads this, so a screen can never name the wrong dollar.
 */
const contracts = V2 as Readonly<Record<string, `0x${string}` | undefined>>;

export type BookAsset =
  | { kind: "usdc"; address: `0x${string}`; symbol: "USDC"; faucetUrl: string; faucetNote: string }
  | { kind: "demo"; address: `0x${string}`; symbol: "dUSD"; faucetUrl: null; faucetNote: string };

export const ASSET: BookAsset = contracts.USDC
  ? {
      kind: "usdc",
      address: contracts.USDC,
      symbol: "USDC",
      faucetUrl: "https://faucet.circle.com",
      faucetNote: "Circle's faucet gives 20 testnet USDC every 2 hours. Choose Monad Testnet there.",
    }
  : {
      kind: "demo",
      address: contracts.DemoUSD!,
      symbol: "dUSD",
      faucetUrl: null,
      faucetNote: "100 dUSD an hour, 1,000 per address. Demo dollars have no value.",
    };

/** True when the release wires HedgedEngine on Perpl and Vessel's Kuru markets. */
export const HEDGED = Boolean(contracts.HedgedEngine);

/** Venue label for the hedged badge, from the reviewed release manifest. */
export const VENUE_LABEL = (RELEASE.venue as string) === "perpl+kuru" ? "Perpl + Kuru testnet" : undefined;
