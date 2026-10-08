import type { Logger } from "pino";
import { erc20Abi, parseAbi, type Address, type Chain, type Hex, type PublicClient } from "viem";
import type { Sql } from "../auth/sql.ts";
import { envInt } from "../addresses.ts";
import type { Manifest } from "../vendor/verify/read.ts";
import { migrateJournal } from "./journal.ts";
import { tick, type KeeperDeps } from "./keeper.ts";
import {
  QUOTER_POLICY_VERSION,
  decideQuotes,
  defaultQuoteConfig,
  kuruBookAbi,
  kuruMarginAbi,
  quoterAllowlist,
  type LiveOrder,
  type QuoteMarket,
  type QuoteObserved,
} from "./quoter.ts";
import { viemChainPort } from "./runner.ts";

/** Kuru's testnet MarginAccount (docs.kuru.io Contract-addresses, checked on chain 2026-10-05). */
const KURU_TESTNET_MARGIN = "0xd029C2D98ff85D8F64799017fE00a59B1159CE02" as const;
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
/** Order ids scanned per book each tick; only the seeder rests orders on Vessel's own markets. */
const SCAN = 200n;

const valuationAbi = parseAbi(["function prices() view returns (uint256, uint256, uint256)"]);

interface Venues {
  kuruMonUsdc: Address;
  kuruMonAusd: Address;
  ausd: Address;
}

function venuesOf(m: Manifest): Venues | null {
  const v = (m as unknown as { venues?: Partial<Venues> }).venues;
  return v?.kuruMonUsdc && v.kuruMonAusd && v.ausd ? (v as Venues) : null;
}

export async function observeQuotes(
  pc: PublicClient,
  m: Manifest,
  sql: Sql,
  seeder: Address,
): Promise<QuoteObserved> {
  const v = venuesOf(m)!;
  const usdc = m.contracts.USDC as Address;
  const books: Array<[Address, Address]> = [
    [v.kuruMonUsdc, usdc],
    [v.kuruMonAusd, v.ausd],
  ];
  const [block, [px, , priceAt], marginMon, walletMon] = await Promise.all([
    pc.getBlock({ blockTag: "latest" }),
    pc.readContract({ address: m.contracts.PerplMarkValuation as Address, abi: valuationAbi, functionName: "prices" }),
    pc.readContract({ address: KURU_TESTNET_MARGIN, abi: kuruMarginAbi, functionName: "getBalance", args: [seeder, NATIVE] }),
    pc.getBalance({ address: seeder }),
  ]);

  const markets: QuoteMarket[] = [];
  let mark = 0n;
  for (const [book, quoteToken] of books) {
    const [params, counter, marginQuote, walletQuote, allowance] = await Promise.all([
      pc.readContract({ address: book, abi: kuruBookAbi, functionName: "getMarketParams" }),
      pc.readContract({ address: book, abi: kuruBookAbi, functionName: "s_orderIdCounter" }),
      pc.readContract({ address: KURU_TESTNET_MARGIN, abi: kuruMarginAbi, functionName: "getBalance", args: [seeder, quoteToken] }),
      pc.readContract({ address: quoteToken, abi: erc20Abi, functionName: "balanceOf", args: [seeder] }),
      pc.readContract({ address: quoteToken, abi: erc20Abi, functionName: "allowance", args: [seeder, KURU_TESTNET_MARGIN] }),
    ]);
    const [pricePrecision, sizePrecision, , , , , tick, minSize] = params;
    const from = BigInt(counter) > SCAN ? BigInt(counter) - SCAN + 1n : 1n;
    const ids: bigint[] = [];
    for (let id = from; id <= BigInt(counter); id++) ids.push(id);
    const rows = await Promise.all(
      ids.map((id) => pc.readContract({ address: book, abi: kuruBookAbi, functionName: "s_orders", args: [Number(id)] })),
    );
    const live: LiveOrder[] = [];
    rows.forEach(([owner, size, , , flippedId, price, flippedPrice, isBuy], i) => {
      if (owner.toLowerCase() === seeder.toLowerCase() && size > 0n) {
        live.push({
          id: ids[i]!,
          price: BigInt(price),
          size,
          isBuy,
          flip: flippedId !== 0 || flippedPrice !== 0,
          flippedId: BigInt(flippedId),
        });
      }
    });
    mark = (px * BigInt(pricePrecision)) / 10n ** 18n;
    markets.push({
      book,
      quoteToken,
      pricePrecision: BigInt(pricePrecision),
      sizePrecision,
      tick: BigInt(tick),
      minSize,
      live,
      marginQuote,
      walletQuote,
      allowance,
    });
  }

  const last = await sql.query<{ target: string; at: Date }>(
    `SELECT lower(target) AS target, max(updated_at) AS at FROM action_journal
      WHERE account = $1 AND action = 'batchUpdate' AND state = 'CONFIRMED' GROUP BY lower(target)`,
    [seeder],
  );
  return {
    now: block.timestamp,
    mark,
    markAt: priceAt,
    margin: KURU_TESTNET_MARGIN,
    seeder,
    marginMon,
    walletMon,
    markets,
    lastQuotedAt: Object.fromEntries(last.map((r) => [r.target, BigInt(Math.floor(new Date(r.at).getTime() / 1000))])),
  };
}

export interface V2QuoterHandle {
  stop(): void;
}

/**
 * Start the testnet quoter when the manifest wires HedgedEngine on Vessel's Kuru markets and
 * V2_QUOTER_PK (the seeder, never the keeper) is set. Refuses mainnet: there, Kuru's official
 * markets have their own makers and Vessel does not quote.
 */
export async function startV2Quoter(opts: {
  manifest: Manifest;
  pc: PublicClient;
  chain: Chain;
  rpcUrl: string;
  log: Logger;
  sql: Sql;
}): Promise<V2QuoterHandle | null> {
  const pk = process.env.V2_QUOTER_PK?.trim() as Hex | undefined;
  const venues = venuesOf(opts.manifest);
  if (!pk || !venues || !opts.manifest.contracts.HedgedEngine) return null;
  if (opts.manifest.chainId !== 10143) throw new Error("the Kuru quoter runs on Monad testnet only");
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("V2_QUOTER_PK must be 0x + 64 hex chars");
  if (process.env.V2_KEEPER_PK?.trim().toLowerCase() === pk.toLowerCase()) {
    throw new Error("V2_QUOTER_PK must not be the keeper key: the seeder holds market-making funds");
  }
  await migrateJournal(opts.sql);

  const chainPort = viemChainPort(opts.pc, opts.chain, opts.rpcUrl, pk);
  const seeder = chainPort.address as Address;
  const deps: KeeperDeps = {
    sql: opts.sql,
    chain: chainPort,
    holderId: `${process.env.RAILWAY_REPLICA_ID ?? "local"}:${process.pid}:quoter`,
    allow: quoterAllowlist([venues.kuruMonUsdc, venues.kuruMonAusd], KURU_TESTNET_MARGIN, [
      opts.manifest.contracts.USDC as Address,
      venues.ausd,
    ]),
    policyVersion: QUOTER_POLICY_VERSION,
    now: () => new Date(),
    leaseStaleAfterMs: 5 * 60_000,
  };
  const intervalMs = envInt("V2_QUOTER_INTERVAL_MS", 15_000, 1_000, 3_600_000);
  let running = true;
  const loop = async () => {
    while (running) {
      try {
        const entry = await tick(deps, async () => decideQuotes(await observeQuotes(opts.pc, opts.manifest, opts.sql, seeder), defaultQuoteConfig));
        if (entry) opts.log.info({ action: entry.action, id: entry.client_request_id, state: entry.state }, "kuru quoter action");
      } catch (err) {
        opts.log.error({ err }, "kuru quoter tick failed");
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };
  void loop();
  opts.log.info({ seeder, markets: [venues.kuruMonUsdc, venues.kuruMonAusd], policy: QUOTER_POLICY_VERSION }, "kuru quoter started");
  return {
    stop() {
      running = false;
    },
  };
}
