import type { FastifyPluginAsync } from "fastify";
import { parseAbi, type Address, type PublicClient } from "viem";
import { evaluate, overall, type Snapshot } from "../vendor/verify/checks.ts";
import { readSnapshot, type Manifest } from "../vendor/verify/read.ts";
import type { Sql } from "../auth/sql.ts";
import { history } from "./indexer.ts";

/**
 * `/v1` evidence API for the v2 book (spec §12–§13). Every response carries the
 * evidence envelope: schemaVersion, environment, chainId, blockNumber,
 * blockHash, observedAt, source, units, status. Current financial state is
 * read from the chain at a finalized block with the independent verifier's own
 * reader and checks (vendored), so the API and `vessel-verify` agree by
 * construction. Money is decimal strings. Failures are explicit statuses with
 * reasons — never an empty success, never a zero standing in for missing data.
 */
export const V1_SCHEMA_VERSION = 1;

export type V1Status = "LIVE" | "SIMULATED" | "MISMATCH" | "UNAVAILABLE";

export interface V1Deps {
  manifest: Manifest;
  client: PublicClient;
  /** injectable for tests; defaults to the verifier's finalized-block reader */
  read?: () => Promise<Snapshot>;
  sourceLabel: string;
  /** v2 event index for /v1/history; omitted → history reports UNAVAILABLE */
  historySql?: Sql;
}

const controllerAbi = parseAbi([
  "function seriesInfo(uint256) view returns (uint8, uint256, bytes32, uint256, uint256, uint256, uint256, uint256, uint256, uint256)",
  "function deposits(uint256) view returns (address, address, uint8, uint64, uint64, uint64, uint8, uint256, uint256)",
]);
const SERIES_STATES = ["NONE", "SUBSCRIPTION_OPEN", "CANCELLED", "ACTIVE", "MATURED_UNWINDING", "CLAIMABLE", "CLOSED", "IMPAIRED"];
const REQ_STATES = ["NONE", "ESCROWED", "ADMITTED", "REFUNDABLE", "REFUNDED"];

const str = (v: bigint | number) => v.toString();

function envelope(d: V1Deps, snap: Snapshot | null, status: V1Status) {
  return {
    schemaVersion: V1_SCHEMA_VERSION,
    environment: d.manifest.environment,
    chainId: d.manifest.chainId,
    blockNumber: snap ? str(snap.blockNumber) : null,
    blockHash: snap?.blockHash ?? null,
    observedAt: snap ? new Date(Number(snap.blockTimestamp) * 1000).toISOString() : new Date().toISOString(),
    source: d.sourceLabel,
    units: snap ? `${snap.asset.symbol}:${snap.asset.decimals}` : null,
    status,
  };
}

export function bookStatus(snap: Snapshot): V1Status {
  const checks = evaluate(snap);
  if (overall(checks) === "MISMATCH") return "MISMATCH";
  if (snap.engine.present && snap.engine.simulated) return "SIMULATED";
  return "LIVE";
}

export function v1Routes(d: V1Deps): FastifyPluginAsync {
  const read = d.read ?? (() => readSnapshot(d.client, d.manifest, "finalized"));
  return async (app) => {
    app.addHook("onSend", async (_req, reply, payload) => {
      reply.header("Cache-Control", "no-store");
      return payload;
    });

    app.get("/v1/book", async (_req, reply) => {
      let snap: Snapshot;
      try {
        snap = await read();
      } catch (err) {
        return reply.code(503).send({
          ...envelope(d, null, "UNAVAILABLE"),
          error: "STALE_DATA",
          reason: err instanceof Error ? err.message.split("\n")[0] : "chain read failed",
        });
      }
      const c = snap.controller;
      const checks = evaluate(snap);
      return {
        ...envelope(d, snap, bookStatus(snap)),
        data: {
          hullNav: str(c.hullNav),
          ballastNav: str(c.ballastNav),
          reserveNav: str(c.reserveNav),
          treasuryLiability: str(c.treasuryLiability),
          recordedActive: str(c.lastActive),
          lossCarry: str(c.lossCarry),
          epoch: str(c.epoch),
          impaired: c.impaired,
          lifetimeAdmitted: str(c.lifetimeAdmitted),
          pendingReserved: str(c.pendingReserved),
          stageCap: str(c.stageCap),
          custody: { pending: str(snap.custody.pending), activeIdle: str(snap.custody.activeIdle) },
          escrow: { totalFunded: str(snap.escrow.totalFunded) },
          ballastSupply: str(snap.ballastSupply),
          engine: snap.engine.present
            ? { simulated: snap.engine.simulated, value: str(snap.engine.value), observedAt: str(snap.engine.observedAt) }
            : null,
        },
        checks,
      };
    });

    app.get<{ Querystring: { limit?: string } }>("/v1/history", async (req, reply) => {
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit ?? "50", 10) || 50, 1), 200);
      if (!d.historySql) {
        return reply.code(503).send({ ...envelope(d, null, "UNAVAILABLE"), error: "STALE_DATA", reason: "event index not configured" });
      }
      try {
        const [cur] = await d.historySql.query<{ block_number: string; block_hash: string }>(
          "SELECT block_number, block_hash FROM v2_indexer_cursor WHERE chain_id = $1",
          [d.manifest.chainId],
        );
        if (!cur) {
          return reply.code(503).send({ ...envelope(d, null, "UNAVAILABLE"), error: "STALE_DATA", reason: "event index has not completed a pass yet" });
        }
        const rows = await history(d.historySql, d.manifest.chainId, limit);
        return {
          ...envelope(d, null, "LIVE"),
          source: "indexer (projection of chain events; canonical rows only)",
          blockNumber: String(cur.block_number),
          blockHash: cur.block_hash,
          data: rows,
        };
      } catch (err) {
        return reply.code(503).send({ ...envelope(d, null, "UNAVAILABLE"), error: "STALE_DATA", reason: err instanceof Error ? err.message : "index read failed" });
      }
    });

    app.get<{ Params: { id: string } }>("/v1/series/:id", async (req, reply) => {
      if (!/^\d{1,9}$/.test(req.params.id)) return reply.code(400).send({ error: "BAD_REQUEST" });
      try {
        const block = await d.client.getBlock({ blockTag: "finalized" });
        const r = await d.client.readContract({
          address: d.manifest.contracts.TrancheController as Address,
          abi: controllerAbi,
          functionName: "seriesInfo",
          args: [BigInt(req.params.id)],
          blockNumber: block.number!,
        });
        const [state, rateBps, termsHash, subscriptionEnd, activation, maturity, principal, recognizedCoupon, accPerUnit, subscriptions] = r;
        if (state === 0) return reply.code(404).send({ error: "SERIES_NOT_FOUND" });
        return {
          ...envelope(d, null, "LIVE"),
          blockNumber: str(block.number!),
          blockHash: block.hash,
          data: {
            id: req.params.id,
            state: SERIES_STATES[state] ?? "UNKNOWN",
            rateBps: str(rateBps),
            termsHash,
            subscriptionEnd: str(subscriptionEnd),
            activation: str(activation),
            maturity: str(maturity),
            principal: str(principal),
            recognizedCoupon: str(recognizedCoupon),
            accPerUnit: str(accPerUnit),
            subscriptions: str(subscriptions),
          },
        };
      } catch (err) {
        return reply.code(503).send({ ...envelope(d, null, "UNAVAILABLE"), error: "STALE_DATA", reason: err instanceof Error ? err.message.split("\n")[0] : "read failed" });
      }
    });

    app.get<{ Params: { id: string } }>("/v1/requests/:id", async (req, reply) => {
      if (!/^\d{1,12}$/.test(req.params.id)) return reply.code(400).send({ error: "BAD_REQUEST" });
      try {
        const block = await d.client.getBlock({ blockTag: "finalized" });
        const r = await d.client.readContract({
          address: d.manifest.contracts.TrancheController as Address,
          abi: controllerAbi,
          functionName: "deposits",
          args: [BigInt(req.params.id)],
          blockNumber: block.number!,
        });
        const [owner, receiver, tranche, seriesId, deadline, createdAt, status, assets, minOut] = r;
        if (status === 0) return reply.code(404).send({ error: "REQUEST_NOT_FOUND" });
        return {
          ...envelope(d, null, "LIVE"),
          blockNumber: str(block.number!),
          blockHash: block.hash,
          data: {
            id: req.params.id,
            owner,
            receiver,
            tranche: tranche === 0 ? "HULL" : "BALLAST",
            seriesId: str(seriesId),
            deadline: str(deadline),
            createdAt: str(createdAt),
            status: REQ_STATES[status] ?? "UNKNOWN",
            assets: str(assets),
            minOut: str(minOut),
          },
        };
      } catch (err) {
        return reply.code(503).send({ ...envelope(d, null, "UNAVAILABLE"), error: "STALE_DATA", reason: err instanceof Error ? err.message.split("\n")[0] : "read failed" });
      }
    });
  };
}
