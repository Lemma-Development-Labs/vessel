import type { PublicClient } from "viem";
import { client, parseManifest, readSnapshot, type Manifest } from "./vendor/verify/read.ts";
import type { Snapshot } from "./vendor/verify/checks.ts";
import {
  ballastState,
  bookState,
  capacity,
  engineState,
  envelope,
  readSeries,
  reserveState,
  riskState,
  statusOf,
  unavailable,
  verifyBook,
  type Envelope,
} from "./state.ts";
import { TESTNET_V2 } from "./manifests/testnet.ts";

export * from "./state.ts";
export * from "./prepare.ts";
export { client, parseManifest, readSnapshot, TESTNET_V2 };
export type { Manifest, Snapshot };

/** Why venue-dependent reads are unavailable on this release (spec gate G01). */
export const NO_VENUE = "no venue position — the testnet engine is a labelled simulation; real venue custody is gate G01";

/**
 * One read session: a snapshot at a single block, then every state is derived
 * from it, so a caller never mixes two states of the book.
 */
export class Vessel {
  constructor(
    readonly manifest: Manifest,
    readonly pc: PublicClient,
    readonly source = "rpc (direct chain read)",
  ) {}

  static testnet(rpcUrl = "https://testnet-rpc.monad.xyz") {
    return new Vessel(parseManifest(TESTNET_V2), client(rpcUrl), `rpc:${new URL(rpcUrl).host} (direct chain read)`);
  }

  /** Snapshot at the finalized block (default) or latest. Throws when the chain cannot be read. */
  snapshot(blockTag: "finalized" | "latest" = "finalized") {
    return readSnapshot(this.pc, this.manifest, blockTag);
  }

  private async wrap<T>(fn: (snap: Snapshot) => T | Promise<T>, blockTag: "finalized" | "latest"): Promise<Envelope<T>> {
    let snap: Snapshot;
    try {
      snap = await this.snapshot(blockTag);
    } catch (err) {
      return unavailable<T>(this.manifest, err instanceof Error ? err.message.split("\n")[0]! : "chain read failed", this.source);
    }
    return envelope(this.manifest, snap, statusOf(snap), await fn(snap), this.source);
  }

  bookState(tag: "finalized" | "latest" = "finalized") {
    return this.wrap(bookState, tag);
  }
  ballastState(tag: "finalized" | "latest" = "finalized") {
    return this.wrap(ballastState, tag);
  }
  reserveState(tag: "finalized" | "latest" = "finalized") {
    return this.wrap(reserveState, tag);
  }
  capacity(tag: "finalized" | "latest" = "finalized") {
    return this.wrap(capacity, tag);
  }
  engineState(tag: "finalized" | "latest" = "finalized") {
    return this.wrap(engineState, tag);
  }
  riskState(tag: "finalized" | "latest" = "finalized") {
    return this.wrap(riskState, tag);
  }
  verifyBook(tag: "finalized" | "latest" = "finalized") {
    return this.wrap(verifyBook, tag);
  }
  hullSeries(id?: bigint, tag: "finalized" | "latest" = "finalized") {
    return this.wrap((snap) => readSeries(this.pc, this.manifest, snap.blockNumber, id), tag);
  }
  /** Venue-dependent reads: explicitly unavailable on a simulated engine, never zero. */
  hedgeState() {
    return Promise.resolve(unavailable(this.manifest, NO_VENUE, this.source));
  }
}
