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
import { POLICY_VERSION, allowlist, decide, type Observed, type PolicyConfig } from "./policy.ts";

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
]);
const custodyAbi = parseAbi(["function activeIdle() view returns (uint256)"]);
const engineAbi = parseAbi(["function value() view returns (uint256, uint256)"]);

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
        est = await pc.estimateGas({ account: account.address, to: tx.to as Address, data: tx.data as Hex });
      } catch (err) {
        throw new RejectedError(`estimate failed: ${firstLine(err)}`);
      }
      const gas = (est * 11n) / 10n;
      if (gas > GAS_CAP) throw new RejectedError(`gas ${gas} above cap ${GAS_CAP}`);
      let hash: Hex;
      try {
        hash = await wallet.sendTransaction({ to: tx.to as Address, data: tx.data as Hex, nonce: Number(tx.nonce), gas, chain });
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

async function observe(pc: PublicClient, m: Manifest, sql: Sql, account: string): Promise<Observed> {
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
  const info = sid > 0n ? await rc<readonly [number, bigint, Hex, bigint, bigint, bigint, bigint, bigint, bigint, bigint]>("seriesInfo", [sid]) : null;
  const activeIdle = await pc.readContract({ address: m.contracts.AssetCustody as Address, abi: custodyAbi, functionName: "activeIdle" });
  const engineValue =
    engineAddr === "0x0000000000000000000000000000000000000000"
      ? 0n
      : (await pc.readContract({ address: engineAddr, abi: engineAbi, functionName: "value" }))[0];
  const [last] = await sql.query<{ at: Date | null }>(
    "SELECT max(updated_at) AS at FROM action_journal WHERE account = $1 AND action = 'settle' AND state = 'CONFIRMED'",
    [account],
  );
  return {
    now: block.timestamp,
    pendingBallastDeposits: depLen - bHead,
    pendingExits: exitLen - eHead,
    activeSeries: sid,
    seriesState: info ? info[0] : 0,
    subscriptionEnd: info ? info[3] : 0n,
    maturity: info ? info[5] : 0n,
    hullNav,
    impaired,
    activeIdle,
    engineValue,
    treasuryLiability,
    lastSettleAt: last?.at ? BigInt(Math.floor(last.at.getTime() / 1000)) : 0n,
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
    allow: allowlist(controller),
    policyVersion: POLICY_VERSION,
    now: () => new Date(),
    leaseStaleAfterMs: 5 * 60_000,
  };
  const intervalMs = envInt("V2_KEEPER_INTERVAL_MS", 30_000, 1_000, 3_600_000);
  let running = true;
  const loop = async () => {
    while (running) {
      try {
        const entry = await tick(deps, async () =>
          decide(await observe(opts.pc, opts.manifest, sql, chainPort.address), cfg, controller),
        );
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
  opts.log.info({ keeper: chainPort.address, controller, policy: POLICY_VERSION }, "v2 keeper started");
  return {
    stop() {
      running = false;
    },
  };
}
