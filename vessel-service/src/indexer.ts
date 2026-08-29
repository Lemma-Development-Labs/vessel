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
  getRpcUrl,
  loadAddresses,
  vesselChain,
  venueAddresses,
  type VesselAddresses,
} from "./addresses.ts";
import type { EngineSnapshotRow, Store, WaterfallRow } from "./db.ts";

const log = pino({ name: "indexer", level: process.env.LOG_LEVEL ?? "info" });

const CHUNK = 2_000n;

export type IndexerHandle = {
  stop: () => void;
};

function asNum(n: bigint): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
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

  const deployed = addrs.deployedBlock;
  let head = 0n;
  for (let attempt = 0; ; attempt++) {
    try {
      head = await client.getBlockNumber();
      break;
    } catch (err) {
      const delay = Math.min(5_000 * 2 ** Math.min(attempt, 6), 60_000);
      log.error({ err, delay }, "getBlockNumber failed, retrying");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  let cursor = head > 0n ? head - 1n : 0n;
  let running = true;
  let chain: Promise<void> = Promise.resolve();

  const enqueue = (from: bigint, to: bigint) => {
    chain = chain
      .then(() => {
        if (!running) return;
        return ingestRange(client, addrs, opts.store, from, to, venues);
      })
      .catch((err) => {
        log.error({ err, from: from.toString(), to: to.toString() }, "ingest failed");
      });
    return chain;
  };

  log.info(
    {
      from: deployed.toString(),
      head: head.toString(),
      engine: addrs.contracts.EngineLite,
      tranches: addrs.contracts.Tranches,
    },
    "backfill Waterfall from deployedBlock",
  );

  const backfill = async () => {
    let from = deployed;
    const target = head;
    while (running && from <= target) {
      const to = from + CHUNK - 1n > target ? target : from + CHUNK - 1n;
      await enqueue(from, to);
      from = to + 1n;
    }
  };
  void backfill();

  const unwatch = client.watchBlocks({
    onBlock: (block) => {
      if (!running || block.number === undefined || block.number === null) return;
      const to = block.number;
      if (to <= cursor) return;
      const rangeFrom = cursor + 1n;
      cursor = to;
      void enqueue(rangeFrom, to);
    },
    onError: (err) => {
      log.error({ err }, "watchBlocks error");
    },
  });

  log.info("watching new blocks");

  return {
    stop: () => {
      running = false;
      unwatch();
    },
  };
}
