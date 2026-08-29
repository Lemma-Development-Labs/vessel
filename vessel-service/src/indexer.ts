import pino from "pino";
import {
  createPublicClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { engineLiteAbi, tranchesAbi, venueAbi } from "./abis.ts";
import {
  getChainId,
  getConfirmations,
  getIndexerChunkBlocks,
  getIndexerPollMs,
  getRpcUrl,
  loadAddresses,
  vesselChain,
  venueAddresses,
  type VesselAddresses,
} from "./addresses.ts";
import type { EngineSnapshotRow, Store, WaterfallRow } from "./db.ts";

const log = pino({ name: "indexer", level: process.env.LOG_LEVEL ?? "info" });

const ERROR_BACKOFF_CAP_MS = 60_000;
const MIN_CHUNK = 1n;

export type IndexerHandle = {
  stop: () => void;
};

/**
 * Live indexer state, read by /health. Module-level because startApi() runs
 * before startIndexer() in index.ts (same shape as getLastSuccessfulCrank()).
 */
export type IndexerStatus = {
  started: boolean;
  chainId: number;
  confirmations: number;
  /** Highest block fully ingested AND persisted. null before the first pass commits. */
  cursor: string | null;
  head: string | null;
  /** head - confirmations. The indexer never advances the cursor past this. */
  safeHead: string | null;
  /** safeHead - cursor. 0 means caught up. null until we have both numbers. */
  lagBlocks: number | null;
  lastPassAt: number | null;
  lastError: string | null;
  /** Current eth_getLogs window. Shrinks when the RPC rejects a wider range. */
  chunkBlocks: number;
};

const status: IndexerStatus = {
  started: false,
  chainId: 0,
  confirmations: 0,
  cursor: null,
  head: null,
  safeHead: null,
  lagBlocks: null,
  lastPassAt: null,
  lastError: null,
  chunkBlocks: 0,
};

export function getIndexerStatus(): IndexerStatus {
  return { ...status };
}

function asNum(n: bigint): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Public Monad testnet RPC answers a too-wide eth_getLogs with
 * "eth_getLogs is limited to a 100 range". Other providers word it differently.
 * Detected so the indexer can shrink its window instead of stalling forever on
 * a range the node will never serve.
 */
function rangeLimit(err: unknown): { hit: boolean; max: bigint | null } {
  const msg = errMsg(err);
  const explicit = /limited to a (\d+) range/i.exec(msg);
  if (explicit?.[1]) return { hit: true, max: BigInt(explicit[1]) };
  const hit =
    /block range|range is too large|query returned more than|too many (results|logs)|exceed(s|ed)? maximum|logs matched|range limit/i.test(
      msg,
    );
  return { hit, max: null };
}

async function ingestRange(
  client: PublicClient,
  addrs: VesselAddresses,
  store: Store,
  fromBlock: bigint,
  toBlock: bigint,
  venues: Address[],
): Promise<void> {
  if (toBlock < fromBlock) return;
  const engine = addrs.contracts.EngineLite;
  const tranches = addrs.contracts.Tranches;

  const [waterfallLogs, crankLogs, fundingLogs] = await Promise.all([
    client.getContractEvents({
      address: tranches,
      abi: tranchesAbi,
      eventName: "Waterfall",
      fromBlock,
      toBlock,
    }),
    client.getContractEvents({
      address: engine,
      abi: engineLiteAbi,
      eventName: "Cranked",
      fromBlock,
      toBlock,
    }),
    venues.length === 0
      ? Promise.resolve([])
      : Promise.all(
          venues.map((address) =>
            client.getContractEvents({
              address,
              abi: venueAbi,
              eventName: "FundingSwept",
              fromBlock,
              toBlock,
            }),
          ),
        ).then((groups) => groups.flat()),
  ]);

  const tsCache = new Map<bigint, number>();
  const blockTs = async (blockNumber: bigint, fallback?: bigint): Promise<number> => {
    if (fallback !== undefined && fallback > 0n) return asNum(fallback);
    const hit = tsCache.get(blockNumber);
    if (hit !== undefined) return hit;
    const block = await client.getBlock({ blockNumber });
    const ts = asNum(block.timestamp);
    tsCache.set(blockNumber, ts);
    return ts;
  };

  for (const ev of waterfallLogs) {
    const a = ev.args;
    if (
      a.gross === undefined ||
      a.fee === undefined ||
      a.toReserve === undefined ||
      a.toTreasury === undefined ||
      a.hullAccrual === undefined ||
      a.toBallast === undefined ||
      a.fromBallast === undefined ||
      a.fromReserve === undefined ||
      a.hullTvl === undefined ||
      a.balTvl === undefined ||
      a.reserve === undefined ||
      a.ts === undefined
    ) {
      continue;
    }
    const row: WaterfallRow = {
      block: asNum(ev.blockNumber),
      ts: asNum(a.ts),
      gross: a.gross.toString(),
      fee: a.fee.toString(),
      to_reserve: a.toReserve.toString(),
      to_treasury: a.toTreasury.toString(),
      hull_accrual: a.hullAccrual.toString(),
      to_ballast: a.toBallast.toString(),
      from_ballast: a.fromBallast.toString(),
      from_reserve: a.fromReserve.toString(),
      hull_tvl: a.hullTvl.toString(),
      bal_tvl: a.balTvl.toString(),
      reserve: a.reserve.toString(),
      tx_hash: ev.transactionHash,
      log_index: ev.logIndex,
    };
    await store.upsertWaterfall(row);
  }

  const fundingByTx = new Map<Hex, bigint>();
  for (const ev of fundingLogs) {
    if (ev.args.realized === undefined) continue;
    fundingByTx.set(ev.transactionHash, ev.args.realized);
  }

  for (const ev of crankLogs) {
    const ts = await blockTs(ev.blockNumber);
    let netDelta = 0n;
    let spot = 0n;
    let shortNotional = 0n;
    try {
      const [deltaRes, spotRes, shortRes, venueRes] = await client.multicall({
        blockNumber: ev.blockNumber,
        allowFailure: true,
        contracts: [
          { address: engine, abi: engineLiteAbi, functionName: "netDelta" },
          { address: engine, abi: engineLiteAbi, functionName: "lastSpotValue" },
          { address: engine, abi: engineLiteAbi, functionName: "shortId" },
          { address: engine, abi: engineLiteAbi, functionName: "venue" },
        ],
      });
      if (deltaRes.status === "success") netDelta = deltaRes.result;
      if (spotRes.status === "success") spot = spotRes.result;
      const shortId = shortRes.status === "success" ? shortRes.result : 0n;
      const venue = venueRes.status === "success" ? venueRes.result : undefined;
      if (shortId > 0n && venue && venue !== "0x0000000000000000000000000000000000000000") {
        try {
          const pos = (await client.readContract({
            address: venue,
            abi: venueAbi,
            functionName: "position",
            args: [shortId],
            blockNumber: ev.blockNumber,
          })) as readonly [bigint, bigint];
          shortNotional = pos[0];
        } catch {
          /* historical eth_call may fail on non-archive RPCs */
        }
      }
    } catch {
      /* keep zeros */
    }

    const row: EngineSnapshotRow = {
      net_delta: netDelta.toString(),
      funding_accrued: (fundingByTx.get(ev.transactionHash) ?? 0n).toString(),
      spot_value: spot.toString(),
      short_notional: shortNotional.toString(),
      ts,
      tx_hash: ev.transactionHash,
      log_index: ev.logIndex,
    };
    await store.upsertSnapshot(row);
  }

  if (waterfallLogs.length || crankLogs.length) {
    log.info(
      {
        from: fromBlock.toString(),
        to: toBlock.toString(),
        waterfall: waterfallLogs.length,
        cranks: crankLogs.length,
      },
      "indexed range",
    );
  }
}

export async function startIndexer(opts: {
  store: Store;
  publicClient?: PublicClient;
  addrs?: VesselAddresses;
}): Promise<IndexerHandle> {
  const rpcUrl = getRpcUrl();
  const chainId = getChainId();
  const addrs = opts.addrs ?? loadAddresses();
  const client =
    opts.publicClient ??
    createPublicClient({
      chain: vesselChain(rpcUrl, chainId),
      transport: http(rpcUrl),
    });

  const confirmations = BigInt(getConfirmations());
  const pollMs = getIndexerPollMs();
  // Shrinks itself on a range-limit error and stays shrunk for the process
  // lifetime — the limit is a property of the RPC, not of the range.
  let chunk = BigInt(getIndexerChunkBlocks());
  const deployed = addrs.deployedBlock;
  const store = opts.store;

  status.chainId = chainId;
  status.confirmations = Number(confirmations);
  status.chunkBlocks = Number(chunk);

  const venues = venueAddresses(addrs);
  try {
    const liveVenue = (await client.readContract({
      address: addrs.contracts.EngineLite,
      abi: engineLiteAbi,
      functionName: "venue",
    })) as Address;
    if (liveVenue && liveVenue !== "0x0000000000000000000000000000000000000000") {
      if (!venues.some((v) => v.toLowerCase() === liveVenue.toLowerCase())) {
        venues.push(liveVenue);
      }
    }
  } catch {
    /* engine not wired yet */
  }

  // Resume point: persisted cursor + 1, floored at deployedBlock. Only when
  // nothing is persisted do we fall all the way back to deployedBlock.
  let cursor: bigint | null = null;
  try {
    cursor = await store.getCursor(chainId);
  } catch (err) {
    log.error({ err: errMsg(err) }, "getCursor failed — treating as no cursor");
  }
  if (cursor !== null && cursor < deployed) {
    log.warn(
      { cursor: cursor.toString(), deployed: deployed.toString() },
      "persisted cursor is below deployedBlock — starting at deployedBlock",
    );
    cursor = null;
  }
  status.cursor = cursor === null ? null : cursor.toString();

  log.info(
    {
      resumeFrom: (cursor === null ? deployed : cursor + 1n).toString(),
      persistedCursor: cursor === null ? null : cursor.toString(),
      deployedBlock: deployed.toString(),
      confirmations: Number(confirmations),
      chunkBlocks: Number(chunk),
      pollMs,
      store: store.kind,
      engine: addrs.contracts.EngineLite,
      tranches: addrs.contracts.Tranches,
    },
    cursor === null
      ? "no persisted cursor — full backfill from deployedBlock"
      : "resuming from persisted cursor",
  );

  let running = true;

  /**
   * One pass. Reads head fresh every time, so there is no window between a
   * head read and a subscription starting — the next pass always covers
   * cursor+1..safeHead no matter how long the previous one took.
   *
   * Throws on the first failing chunk; the cursor keeps whatever the last
   * cleanly-ingested chunk set, and the next pass retries from there.
   */
  const pass = async (): Promise<void> => {
    const head = await client.getBlockNumber();
    const safeHead = head > confirmations ? head - confirmations : 0n;
    status.head = head.toString();
    status.safeHead = safeHead.toString();

    if (safeHead < deployed) {
      status.lagBlocks = 0;
      return;
    }

    // Re-index the trailing CONFIRMATIONS blocks every pass. Re-ingesting a
    // block is idempotent (upserts keyed on (tx_hash, log_index)), so a row
    // that was reorged out is simply overwritten by the canonical one.
    const base = cursor === null ? deployed : cursor + 1n;
    const rewound = base > confirmations ? base - confirmations : 0n;
    let from = rewound < deployed ? deployed : rewound;

    while (running && from <= safeHead) {
      const to = from + chunk - 1n > safeHead ? safeHead : from + chunk - 1n;
      try {
        await ingestRange(client, addrs, store, from, to, venues);
      } catch (err) {
        const limit = rangeLimit(err);
        if (limit.hit && chunk > MIN_CHUNK) {
          const proposed = limit.max && limit.max >= MIN_CHUNK ? limit.max : chunk / 2n;
          const next = proposed < MIN_CHUNK ? MIN_CHUNK : proposed;
          // Only retry if the window actually got smaller. Otherwise the same
          // request would be replayed forever against the same rejection.
          if (next < chunk) {
            chunk = next;
            status.chunkBlocks = Number(chunk);
            log.warn(
              { from: from.toString(), to: to.toString(), chunk: chunk.toString() },
              "rpc rejected the block range — shrinking chunk and retrying the same range",
            );
            continue; // same `from`, narrower window; cursor untouched
          }
        }
        throw err;
      }
      // Only now is the range durable — advance past it, never past a throw.
      if (cursor === null || to > cursor) {
        await store.setCursor(chainId, to);
        cursor = to;
        status.cursor = cursor.toString();
      }
      from = to + 1n;
    }

    status.lagBlocks =
      cursor === null ? asNum(safeHead - deployed) : asNum(safeHead > cursor ? safeHead - cursor : 0n);
  };

  let errStreak = 0;
  const loop = async (): Promise<void> => {
    while (running) {
      try {
        await pass();
        errStreak = 0;
        status.lastError = null;
        status.lastPassAt = Math.floor(Date.now() / 1000);
        if (running) await sleep(pollMs);
      } catch (err) {
        errStreak += 1;
        status.lastError = errMsg(err);
        const delay = Math.min(pollMs * 2 ** Math.min(errStreak, 6), ERROR_BACKOFF_CAP_MS);
        log.error(
          {
            err: status.lastError,
            cursor: status.cursor,
            safeHead: status.safeHead,
            errStreak,
            retryInMs: delay,
          },
          "indexer pass failed — cursor not advanced past the failing range",
        );
        if (running) await sleep(delay);
      }
    }
  };

  status.started = true;
  void loop();
  log.info({ pollMs, chunkBlocks: Number(chunk) }, "indexer loop started");

  return {
    stop: () => {
      running = false;
      status.started = false;
    },
  };
}
