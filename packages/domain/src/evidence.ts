/**
 * Shared evidence envelope and source-freshness tags (spec §12).
 *
 * Every public data point carries its environment, source block, and one of
 * six tags. Missing data has no numeric value — UNAVAILABLE structurally
 * cannot carry one. A cached last-good value is STALE, shown only with its
 * timestamp; it cannot authorize new risk.
 */

export const SCHEMA_VERSION = 1;

export type Environment = "local" | "testnet" | "mainnet";

export type SourceTag =
  | "LIVE"
  | "STALE"
  | "UNAVAILABLE"
  | "PARTIAL"
  | "MISMATCH"
  | "SIMULATED";

/** JSON-safe: integers travel as decimal strings (spec §7). */
export interface Evidence {
  schemaVersion: typeof SCHEMA_VERSION;
  environment: Environment;
  chainId: number;
  /** decimal string */
  blockNumber: string;
  blockHash: `0x${string}`;
  /** ISO-8601 UTC */
  observedAt: string;
  /** e.g. "rpc:https://testnet-rpc.monad.xyz", "indexer", "sim" */
  source: string;
  /** key into UNIT_DEFS for the value's unit */
  units: string;
  /** pointers to raw evidence: tx hashes, content-hashed archives, reports */
  evidenceRefs: string[];
}

/** Envelope for data that could not be read: no block, no value. */
export type UnavailableEvidence = Pick<
  Evidence,
  | "schemaVersion"
  | "environment"
  | "chainId"
  | "observedAt"
  | "source"
  | "evidenceRefs"
>;

export type Tagged<T> =
  | {
      tag: "LIVE" | "STALE" | "SIMULATED";
      value: T;
      evidence: Evidence;
    }
  | {
      /**
       * Sources disagree (MISMATCH) or only some were readable (PARTIAL).
       * The reason is mandatory: a mismatch shown without its cause is a
       * number the reader cannot act on. Never resolve it by averaging.
       */
      tag: "PARTIAL" | "MISMATCH";
      value: T;
      reason: string;
      evidence: Evidence;
    }
  | {
      tag: "UNAVAILABLE";
      reason: string;
      evidence: UnavailableEvidence;
    };

export function hasValue<T>(
  t: Tagged<T>,
): t is Extract<Tagged<T>, { value: T }> {
  return t.tag !== "UNAVAILABLE";
}

/**
 * Only LIVE state authorizes new risk (spec §12). STALE, PARTIAL, MISMATCH,
 * SIMULATED and UNAVAILABLE never do.
 */
export function canAuthorizeNewRisk(t: Tagged<unknown>): boolean {
  return t.tag === "LIVE";
}
