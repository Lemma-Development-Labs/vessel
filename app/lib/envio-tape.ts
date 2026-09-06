import { unavailable, type Live } from "./live";

/**
 * Envio HyperIndex crank tape.
 *
 * GATE-0: we have not verified the HyperIndex schema / event field names for
 * Vessel settle/crank events on Monad testnet (see docs/resources/verification.md
 * §5). Until a verified GraphQL query is checked in, the tape is unavailable —
 * never synthesised from keeper JSON (that would forfeit the Envio bounty claim).
 */

export type CrankTapeRow = {
  block: bigint;
  actor: string;
  decision: string;
  gasLimit: bigint;
  delta: bigint;
  txHash: string;
};

export function envioGraphqlUrl(): string | undefined {
  const u = process.env.NEXT_PUBLIC_ENVIO_GRAPHQL?.trim();
  return u && u.length > 0 ? u : undefined;
}

export function crankTapeLive(): Live<CrankTapeRow[]> {
  const url = envioGraphqlUrl();
  if (!url) {
    return unavailable(
      "Envio crank tape — GATE-0: HyperIndex schema unverified; NEXT_PUBLIC_ENVIO_GRAPHQL unset. See docs/resources/verification.md §5.",
    );
  }
  return unavailable(
    "Envio crank tape — GATE-0: endpoint configured but schema/query not verified; refusing to guess field names.",
  );
}
