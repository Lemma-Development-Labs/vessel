import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import type { Logger } from "pino";
import {
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { pgSql, pgliteSql, type Sql } from "../auth/sql.ts";
import { envInt } from "../addresses.ts";
import { pgSsl } from "../db.ts";
import type { Manifest } from "../vendor/verify/read.ts";
import { migrateJournal } from "./journal.ts";
import { RejectedError, TimeoutError, tick, type ChainPort, type KeeperDeps } from "./keeper.ts";
import { POLICY_VERSION, allowlist, decide, engineCashNeed, type Observed, type PolicyConfig } from "./policy.ts";
import { HEDGE_POLICY_VERSION, decideHedge, defaultHedgeConfig, engineAllowlist, type HedgeConfig, type HedgeObserved } from "./hedge.ts";

/** Monad bills the gas LIMIT: estimate + 10%, hard cap (see OPS.md gas notes). */
const GAS_CAP = 2_000_000n;
const RECEIPT_TIMEOUT_MS = 60_000;

const viewAbi = parseAbi([
  "function queueLengths() view returns (uint256, uint256)",
  "function ballastHead() view returns (uint256)",
  "function exitHead() view returns (uint256)",
  "function activeSeries() view returns (uint256)",
  "function seriesInfo(uint256) view returns (uint8, uint256, bytes32, uint256, uint256, uint256, uint256, uint256, uint256, uint256)",
  "function hullNav() view returns (uint256)",
  "function impaired() view returns (bool)",
  "function treasuryLiability() view returns (uint256)",
  "function engine() view returns (address)",
  "function exits(uint256) view returns (address, address, uint64, uint8, uint256, uint256, uint256)",
  "function EXIT_COOLDOWN() view returns (uint256)",
]);
const custodyAbi = parseAbi(["function activeIdle() view returns (uint256)"]);
const engineAbi = parseAbi(["function value() view returns (uint256, uint256)"]);
const hedgedEngineAbi = parseAbi([
  "function usdcCash() view returns (uint256)",
  "function ausdCash() view returns (uint256)",
  "function monQty() view returns (uint256)",
  "function shortLots() view returns (uint256)",
  "function perplAccountId() view returns (uint256)",
  "function perplEquity() view returns (uint256)",
  "function sliceCap() view returns (uint256)",
  "function valuation() view returns (address)",
  "function perpl() view returns (address)",
  "function guardian() view returns (address)",
  "function spotSizePrecision() view returns (uint256)",
  "function perpPriceScale() view returns (uint256)",
  "function perpLotScale() view returns (uint256)",
  "function leverageHdths() view returns (uint256)",
]);
const valuationAbi = parseAbi(["function prices() view returns (uint256, uint256, uint256)"]);
const perplAbi = parseAbi([
  "function getMinAccountOpenCNS() view returns (uint256)",
  "function getAccountByAddr(address) view returns ((uint256 accountId, uint256 balanceCNS, uint256 lockedBalanceCNS, uint8 frozen, address accountAddr, (uint256, uint256, uint256, uint256) positions))",
]);
const guardianAbi = parseAbi(["function isPaused(uint8) view returns (bool)"]);

const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0]!;

export function viemChainPort(pc: PublicClient, chain: Chain, rpcUrl: string, pk: Hex): ChainPort {
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  return {
    address: account.address,
    minedNonce: async () => BigInt(await pc.getTransactionCount({ address: account.address, blockTag: "latest" })),
    pendingNonce: async () => BigInt(await pc.getTransactionCount({ address: account.address, blockTag: "pending" })),
    async send(tx) {
      // Nothing below the sendTransaction call can have broadcast anything: those failures are refusals.
      let est: bigint;
      try {
        est = await pc.estimateGas({ account: account.address, to: tx.to as Address, data: tx.data as Hex, value: tx.value ?? 0n });
      } catch (err) {
        throw new RejectedError(`estimate failed: ${firstLine(err)}`);
      }
      const gas = (est * 11n) / 10n;
      if (gas > GAS_CAP) throw new RejectedError(`gas ${gas} above cap ${GAS_CAP}`);
      let hash: Hex;
      try {
        hash = await wallet.sendTransaction({ to: tx.to as Address, data: tx.data as Hex, value: tx.value ?? 0n, nonce: Number(tx.nonce), gas, chain });
      } catch (err) {
        const msg = firstLine(err);
        if (/insufficient funds/i.test(msg)) throw new RejectedError(msg);
        // Timeouts, "already known", "nonce too low", replacements: the tx may exist. Reconcile decides.
        throw new TimeoutError(msg);
      }
      try {
        await pc.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
      } catch {
        // Not a failure: the journal holds the hash and reconcile() resolves it later.
      }
      return hash;
    },
    async receipt(hash) {
      try {
        const r = await pc.getTransactionReceipt({ hash: hash as Hex });
        return { status: r.status };
      } catch {
        return null;
      }
    },
  };
}

export async function observe(pc: PublicClient, m: Manifest, sql: Sql, account: string): Promise<Observed> {
  const C = m.contracts.TrancheController as Address;
  const rc = <T>(fn: string, args: readonly unknown[] = []) =>
    pc.readContract({ address: C, abi: viewAbi, functionName: fn as never, args: args as never }) as Promise<T>;
  const [[depLen, exitLen], bHead, eHead, sid, hullNav, impaired, treasuryLiability, engineAddr, block] = await Promise.all([
    rc<[bigint, bigint]>("queueLengths"),
    rc<bigint>("ballastHead"),
    rc<bigint>("exitHead"),
    rc<bigint>("activeSeries"),
    rc<bigint>("hullNav"),
    rc<boolean>("impaired"),
    rc<bigint>("treasuryLiability"),
    rc<Address>("engine"),
    pc.getBlock({ blockTag: "latest" }),
  ]);
  const series = sid > 0n ? await rc<readonly [number, bigint, Hex, bigint, bigint, bigint, bigint, bigint, bigint, bigint]>("seriesInfo", [sid]) : null;
  const activeIdle = await pc.readContract({ address: m.contracts.AssetCustody as Address, abi: custodyAbi, functionName: "activeIdle" });
  let headExitReadyAt = 0n;
  if (exitLen > eHead) {
    // exitHead is a queue position; exits() is keyed by id. requestBallastRedeem pushes ids in
    // creation order starting at 1, so position i always holds id i + 1.
    const [head, cooldown] = await Promise.all([
      rc<readonly [Address, Address, bigint, number, bigint, bigint, bigint]>("exits", [eHead + 1n]),
      rc<bigint>("EXIT_COOLDOWN"),
    ]);
    headExitReadyAt = head[2] + cooldown;
  }
  const engineValue =
    engineAddr === "0x0000000000000000000000000000000000000000"
      ? 0n
      : (await pc.readContract({ address: engineAddr, abi: engineAbi, functionName: "value" }))[0];
  // A hedged engine pays out only its USDC cash; a simulated one pays from its whole value.
  const engineCash = m.contracts.HedgedEngine
    ? await pc.readContract({ address: engineAddr, abi: hedgedEngineAbi, functionName: "usdcCash" })
    : undefined;
  const [last] = await sql.query<{ at: Date | null }>(
    "SELECT max(updated_at) AS at FROM action_journal WHERE account = $1 AND action = 'settle' AND state = 'CONFIRMED'",
    [account],
  );
  return {
    now: block.timestamp,
    pendingBallastDeposits: depLen - bHead,
    pendingExits: exitLen - eHead,
    headExitReadyAt,
    activeSeries: sid,
    seriesState: series ? series[0] : 0,
    subscriptionEnd: series ? series[3] : 0n,
    maturity: series ? series[5] : 0n,
    hullNav,
    impaired,
    activeIdle,
    engineValue,
    engineCash,
    treasuryLiability,
    engineWired: engineAddr !== "0x0000000000000000000000000000000000000000",
    lastSettleAt: last?.at ? BigInt(Math.floor(last.at.getTime() / 1000)) : 0n,
  };
}

/** HedgedEngine state for the hedge policy. `cashShortfall` comes from the controller's view. */
export async function observeHedge(pc: PublicClient, engine: Address, now: bigint, cashShortfall: bigint): Promise<HedgeObserved> {
  const re = <T>(fn: string) => pc.readContract({ address: engine, abi: hedgedEngineAbi, functionName: fn as never }) as Promise<T>;
  const [valuation, perpl, guardian, sizeP, priceS, lotS, lev] = await Promise.all([
    re<Address>("valuation"),
    re<Address>("perpl"),
    re<Address>("guardian"),
    re<bigint>("spotSizePrecision"),
    re<bigint>("perpPriceScale"),
    re<bigint>("perpLotScale"),
    re<bigint>("leverageHdths"),
  ]);
  const [[px, fx, priceAt], [value], sliceCap, usdcCash, ausdCash, monQty, shortLots, accountId, equity, paused, minOpen] =
    await Promise.all([
      pc.readContract({ address: valuation, abi: valuationAbi, functionName: "prices" }),
      pc.readContract({ address: engine, abi: engineAbi, functionName: "value" }),
      re<bigint>("sliceCap"),
      re<bigint>("usdcCash"),
      re<bigint>("ausdCash"),
      re<bigint>("monQty"),
      re<bigint>("shortLots"),
      re<bigint>("perplAccountId"),
      re<bigint>("perplEquity"),
      pc.readContract({ address: guardian, abi: guardianAbi, functionName: "isPaused", args: [2] }),
      pc.readContract({ address: perpl, abi: perplAbi, functionName: "getMinAccountOpenCNS" }),
    ]);
  const perplFree =
    accountId > 0n ? (await pc.readContract({ address: perpl, abi: perplAbi, functionName: "getAccountByAddr", args: [engine] })).balanceCNS : 0n;
  return {
    now,
    px,
    fx,
    priceAt,
    riskPaused: paused,
    value,
    sliceCap,
    usdcCash,
    ausdCash,
    monQty,
    shortLots,
    perplAccountId: accountId,
    perplFree,
    perplEquity: equity,
    minAccountOpen: minOpen,
    spotSizePrecision: sizeP,
    perpPriceScale: priceS,
    perpLotScale: lotS,
    leverageHdths: lev,
    cashShortfall,
  };
}

export interface V2KeeperHandle {
  stop(): void;
}

/**
 * Open the v2 operational database: DATABASE_URL, or an in-process PGlite
 * outside mainnet (durability then ends with the process — logged loudly).
 * Shared by the keeper journal, the v2 indexer and /v1/history.
 */
export function openV2Sql(environment: "local" | "testnet" | "mainnet", log: Logger): Sql {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (dbUrl) return pgSql(new pg.Pool({ connectionString: dbUrl, ssl: pgSsl(dbUrl) }));
  if (environment === "mainnet") throw new Error("mainnet v2 services require DATABASE_URL (durable journal)");
  log.warn("DATABASE_URL unset — v2 journal and index in in-process PGlite (NOT durable across restarts)");
  return pgliteSql(new PGlite());
}

/** Start the v2 keeper when a v2 manifest and V2_KEEPER_PK are configured. */
export async function startV2Keeper(opts: {
  manifest: Manifest;
  pc: PublicClient;
  chain: Chain;
  rpcUrl: string;
  environment: "local" | "testnet" | "mainnet";
  log: Logger;
  sql: Sql;
}): Promise<V2KeeperHandle | null> {
  const pk = process.env.V2_KEEPER_PK?.trim() as Hex | undefined;
  if (!pk) {
    opts.log.warn("V2_KEEPER_PK unset — v2 keeper not started");
    return null;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("V2_KEEPER_PK must be 0x + 64 hex chars");
  const sql = opts.sql;
  await migrateJournal(sql);

  const chainPort = viemChainPort(opts.pc, opts.chain, opts.rpcUrl, pk);
  const controller = opts.manifest.contracts.TrancheController as Address;
  const hedged = opts.manifest.contracts.HedgedEngine as Address | undefined;
  // V2_HEDGE_MIN_MOVE_MICRO (USDC base units, 10,000–100,000,000): the smallest hedge trade worth
  // sending. The engine's slice cap is 0.5% of its value, so the default 1 USDC needs a ~200 USDC
  // engine before spot trades start; testnet can set 100,000 (0.10 USDC) to hedge a small book.
  const hedgeCfg: HedgeConfig = {
    ...defaultHedgeConfig,
    minMove: BigInt(envInt("V2_HEDGE_MIN_MOVE_MICRO", Number(defaultHedgeConfig.minMove), 10_000, 100_000_000)),
  };
  const cfg: PolicyConfig = {
    settleEverySec: BigInt(process.env.V2_SETTLE_EVERY_SEC ?? "3600"),
    batchSize: 10n,
    idleTargetBps: 1_500n,
    minMove: 1_000_000n,
  };
  const deps: KeeperDeps = {
    sql,
    chain: chainPort,
    holderId: `${process.env.RAILWAY_REPLICA_ID ?? "local"}:${process.pid}`,
    allow: hedged ? [...allowlist(controller), ...engineAllowlist(hedged)] : allowlist(controller),
    policyVersion: hedged ? `${POLICY_VERSION}+${HEDGE_POLICY_VERSION}` : POLICY_VERSION,
    now: () => new Date(),
    leaseStaleAfterMs: 5 * 60_000,
  };
  const intervalMs = envInt("V2_KEEPER_INTERVAL_MS", 30_000, 1_000, 3_600_000);
  let running = true;
  const loop = async () => {
    while (running) {
      try {
        const entry = await tick(deps, async () => {
          const o = await observe(opts.pc, opts.manifest, sql, chainPort.address);
          // Controller obligations come first; the hedge acts only when the controller has nothing to do.
          const next = decide(o, cfg, controller);
          if (next || !hedged || !o.engineWired) return next;
          const { need, available } = engineCashNeed(o, cfg);
          const h = await observeHedge(opts.pc, hedged, o.now, need > available ? need - available : 0n);
          return decideHedge(h, hedgeCfg, hedged);
        });
        if (entry) {
          const fields = { action: entry.action, id: entry.client_request_id, nonce: entry.planned_nonce, state: entry.state };
          if (entry.state === "REJECTED") opts.log.warn(fields, "v2 keeper action refused by node");
          else opts.log.info(fields, "v2 keeper action sent");
        }
      } catch (err) {
        opts.log.error({ err }, "v2 keeper tick failed");
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };
  void loop();
  opts.log.info({ keeper: chainPort.address, controller, hedgedEngine: hedged ?? null, policy: deps.policyVersion }, "v2 keeper started");
  return {
    stop() {
      running = false;
    },
  };
}
