import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  NO_VENUE,
  PrepareError,
  prepareBallastDeposit,
  prepareBallastExit,
  prepareCancelDeposit,
  prepareCancelExit,
  prepareClaimExit,
  prepareClaimHull,
  prepareClaimRefund,
  prepareHullSubscription,
  unavailable,
  type Envelope,
  type Manifest,
  type Vessel,
} from "./vendor/sdk/index.ts";

/**
 * Public Vessel MCP (spec §17). Read and verify tools return the same
 * evidence envelope as the /v1 API. Venue-dependent tools answer UNAVAILABLE
 * with the reason (gate G01) — never a zero. Preparation tools exist only
 * when the operator enables the separate gate, and even then they only encode
 * unsigned calls to manifest addresses for the caller's own wallet: no keys,
 * no submission, no arbitrary calldata, no operator tools.
 *
 * Tool inputs are untrusted data. Nothing in an argument can widen what a
 * tool does: targets come from the release manifest, receivers are the owner.
 */

export const SERVER_NAME = "vessel";
export const SERVER_VERSION = "0.1.0";

/** The read surface the tools need — a `Vessel` from the SDK, or a fake in tests. */
export type Reader = Pick<
  Vessel,
  "manifest" | "bookState" | "ballastState" | "reserveState" | "capacity" | "engineState" | "riskState" | "verifyBook" | "hullSeries" | "hedgeState"
>;

export type Options = {
  reader: Reader;
  /** Base URL of the Vessel service, for indexed history. Unset → history tools are UNAVAILABLE. */
  apiUrl?: string;
  /** Spec §17 "prepare behind a separate gate": off unless explicitly enabled. */
  enablePrepare?: boolean;
  /** Clock for preparation expiry; injectable for tests. */
  now?: () => number;
  fetchFn?: typeof fetch;
};

const json = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
const reply = (x: unknown) => ({ content: [{ type: "text" as const, text: json(x) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

const READ = { readOnlyHint: true, openWorldHint: true } as const;
const units = z.string().regex(/^\d{1,40}$/, "a non-negative integer in base units, as a decimal string");
const id = z.string().regex(/^\d{1,20}$/, "a positive integer id, as a decimal string");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "a 0x-prefixed 20-byte address");

export function buildServer(o: Options): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const r = o.reader;
  const m: Manifest = r.manifest;
  const fetchFn = o.fetchFn ?? fetch;
  // eslint-disable-next-line no-restricted-syntax -- wall-clock unix seconds for preparation expiry, not a money value
  const now = o.now ?? (() => Math.floor(Date.now() / 1000));
  const tag = { finalized: "finalized" as const };

  const readTool = (name: string, description: string, fn: () => Promise<Envelope<unknown>>) =>
    server.registerTool(name, { description, annotations: READ }, async () => reply(await fn()));

  readTool("book_state", "Hull, Ballast and reserve NAV, treasury liability, recorded assets, custody and escrow, at one finalized block.", () => r.bookState(tag.finalized));
  readTool("ballast_state", "Ballast NAV, unit supply and junior cover B/(H+B) against the 20% floor and 30% target.", () => r.ballastState(tag.finalized));
  readTool("reserve_state", "Reserve NAV, its 2% target and the loss carryforward.", () => r.reserveState(tag.finalized));
  readTool("capacity", "Beta stage cap, admitted and pending amounts, remaining capacity and the immutable 25,000 ceiling.", () => r.capacity(tag.finalized));
  readTool("engine_state", "Whether a strategy engine is wired, whether it is SIMULATED, its value and observation time.", () => r.engineState(tag.finalized));
  readTool("risk_state", "Impairment, junior cover, capacity and the independent checks over the same block.", () => r.riskState(tag.finalized));
  readTool("verify_waterfall", "Recompute the book's conservation checks (identity, backing, caps, units) with the independent verifier's code.", () => r.verifyBook(tag.finalized));
  readTool("get_evidence", "The independent verifier's verdicts with block number and hash, plus the release manifest they were checked against.", async () => {
    const e = await r.verifyBook(tag.finalized);
    return e.status === "UNAVAILABLE" ? e : { ...e, data: { ...e.data, manifest: m } };
  });

  server.registerTool(
    "hull_series",
    { description: "Hull series terms and state: rate, terms hash, window, activation, maturity, principal, subscribers. Omit id for all.", inputSchema: { id: id.optional() }, annotations: READ },
    async ({ id: sid }) => reply(await r.hullSeries(sid === undefined ? undefined : BigInt(sid), tag.finalized)),
  );

  server.registerTool(
    "verify_hull_series",
    { description: "A series' on-chain terms and state. Rate derivation from observed carry is reported as unavailable until 30 days of data exist.", inputSchema: { id }, annotations: READ },
    async ({ id: sid }) => {
      const e = await r.hullSeries(BigInt(sid), tag.finalized);
      if (e.status === "UNAVAILABLE") return reply(e);
      if (!e.data?.length) return fail(`series ${sid} does not exist`);
      return reply({ ...e, data: { series: e.data[0], rateDerivation: { status: "UNAVAILABLE", reason: "needs 30 days of observed carry; the rate is set by governance with a published terms hash" } } });
    },
  );

  // Venue-dependent tools: explicitly unavailable on this release, never zero-filled.
  for (const [name, description] of [
    ["hedge_state", "Spot quantity, signed perp quantity, delta, margin and open orders."],
    ["market_state", "Venue mark, index and depth for the approved market."],
    ["funding_history", "Observed venue funding over time."],
    ["verify_hedge", "Recompute the hedge from venue and chain reads."],
  ] as const) {
    server.registerTool(name, { description: `${description} Unavailable while the testnet engine is simulated (gate G01).`, annotations: READ }, async () =>
      reply(unavailable(m, NO_VENUE, "mcp")),
    );
  }

  server.registerTool(
    "waterfall_history",
    { description: "Indexed settlement events (EpochSettled), newest first, with finality. Requires the Vessel service.", inputSchema: { limit: z.number().int().min(1).max(200).optional() }, annotations: READ },
    async ({ limit }) => {
      if (!o.apiUrl) return reply(unavailable(m, "no Vessel service configured (VESSEL_API_URL)", "mcp"));
      try {
        const res = await fetchFn(`${o.apiUrl}/v1/history?limit=200`, { headers: { accept: "application/json" } });
        const body = (await res.json()) as Envelope<Array<{ event: string }>>;
        if (!res.ok || body.status === "UNAVAILABLE" || !Array.isArray(body.data)) {
          return reply(unavailable(m, `history unavailable: ${body.reason ?? res.status}`, "indexer"));
        }
        return reply({ ...body, data: body.data.filter((row) => row.event === "EpochSettled").slice(0, limit ?? 50) });
      } catch (err) {
        return reply(unavailable(m, `history unavailable: ${err instanceof Error ? err.message : "request failed"}`, "indexer"));
      }
    },
  );

  if (o.enablePrepare) registerPrepare(server, m, now);
  return server;
}

/** Typed, unsigned preparation. Every result names the wallet authorization boundary and its expiry. */
function registerPrepare(server: McpServer, m: Manifest, now: () => number) {
  const PREP = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
  const wrap = (fn: () => unknown) => {
    try {
      return reply(fn());
    } catch (err) {
      if (err instanceof PrepareError) return fail(err.message);
      throw err;
    }
  };
  const deadline = z.string().regex(/^\d{1,12}$/, "unix seconds");

  server.registerTool(
    "prepare_ballast_deposit",
    {
      description: "Unsigned calls for a Ballast deposit request by `owner`: exact-amount dUSD approval to custody, then requestDeposit. The user's wallet signs each call; nothing is sent.",
      inputSchema: { owner: address, assets: units, minUnits: units, deadline, currentAllowance: units.optional() },
      annotations: PREP,
    },
    async (a) =>
      wrap(() =>
        prepareBallastDeposit({
          manifest: m, owner: a.owner, assets: BigInt(a.assets), minUnits: BigInt(a.minUnits), deadline: BigInt(a.deadline), now: now(),
          ...(a.currentAllowance === undefined ? {} : { currentAllowance: BigInt(a.currentAllowance) }),
        }),
      ),
  );
  server.registerTool(
    "prepare_hull_subscription",
    {
      description: "Unsigned calls to subscribe `owner` to an open Hull series at the published rate (minRateBps). The user's wallet signs; nothing is sent.",
      inputSchema: { owner: address, seriesId: id, assets: units, minRateBps: units, deadline, currentAllowance: units.optional() },
      annotations: PREP,
    },
    async (a) =>
      wrap(() =>
        prepareHullSubscription({
          manifest: m, owner: a.owner, seriesId: BigInt(a.seriesId), assets: BigInt(a.assets), minRateBps: BigInt(a.minRateBps), deadline: BigInt(a.deadline), now: now(),
          ...(a.currentAllowance === undefined ? {} : { currentAllowance: BigInt(a.currentAllowance) }),
        }),
      ),
  );
  server.registerTool(
    "prepare_ballast_exit",
    { description: "Unsigned call locking `units` of the owner's Ballast into an exit paid to the owner.", inputSchema: { owner: address, units, minAssets: units }, annotations: PREP },
    async (a) => wrap(() => prepareBallastExit({ manifest: m, owner: a.owner, units: BigInt(a.units), minAssets: BigInt(a.minAssets), now: now() })),
  );
  const byId = [
    ["prepare_cancel_deposit", "Cancel an unadmitted deposit request (it becomes refundable).", prepareCancelDeposit],
    ["prepare_claim_refund", "Pay a refundable request back to its owner.", prepareClaimRefund],
    ["prepare_cancel_exit", "Cancel the unfunded part of a Ballast exit.", prepareCancelExit],
    ["prepare_claim_exit", "Pay a funded exit's escrow to its fixed receiver.", prepareClaimExit],
  ] as const;
  for (const [name, description, fn] of byId) {
    server.registerTool(name, { description: `Unsigned call. ${description}`, inputSchema: { id }, annotations: PREP }, async (a) =>
      wrap(() => fn({ manifest: m, id: BigInt(a.id), now: now() })),
    );
  }
  server.registerTool(
    "prepare_claim_hull",
    { description: "Unsigned call claiming the caller's funded payout from a Hull series.", inputSchema: { seriesId: id }, annotations: PREP },
    async (a) => wrap(() => prepareClaimHull({ manifest: m, seriesId: BigInt(a.seriesId), now: now() })),
  );
}
