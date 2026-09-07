/**
 * Vessel Perpl short-manager keeper.
 *
 * Flags:
 *   --dry-run   print decisions / Change frames; place nothing
 *   --once      one decide→act cycle then exit
 *
 * Connection discipline: 2 sockets (trading + market-data). A browser session
 * on testnet.perpl.xyz with the same wallet eats the 4-connection budget.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import WebSocket, { type WebSocket as WsSocket } from "ws";

import {
  parseSecretHex,
  tradingWsSignInFrame,
  type AuthConfig,
} from "./auth.ts";
import { RequestBudget } from "./budget.ts";
import { clients, crankOnce, readEngineState, CRANK_GAS_LIMIT } from "./chain.ts";
import { executeDecision } from "./execute.ts";
import { MarketDataClient } from "./marketdata.ts";
import { decide } from "./policy.ts";
import {
  reconcileAfterReconnect,
  shortNotionalFromPositions,
  type Truth,
} from "./reconcile.ts";
import { healthPayload, recordDecision, setHealth, isCreHaltLatched, latchCreHalt } from "./status.ts";
import { stateToSnapshot, type SnapshotJson } from "./cre-snapshot.ts";
import { jitter, recoveryFor } from "./ws.ts";
import type { Decision, Fill, KeeperState } from "./types.ts";

const dryRun = process.argv.includes("--dry-run");
const once = process.argv.includes("--once");

function envOpt(name: string, fallback: string): string {
  return process.env[name] && process.env[name] !== "" ? process.env[name]! : fallback;
}

function loadEngineAddress(): `0x${string}` {
  if (process.env.ENGINE_LITE) return process.env.ENGINE_LITE as `0x${string}`;
  try {
    const raw = readFileSync(resolve(process.cwd(), "../ADDRESSES.json"), "utf8");
    const j = JSON.parse(raw) as { contracts?: { EngineLite?: string } };
    if (j.contracts?.EngineLite) return j.contracts.EngineLite as `0x${string}`;
  } catch {
    /* */
  }
  throw new Error("ENGINE_LITE unset and ADDRESSES.json missing EngineLite");
}

function killSwitchArmed(path: string): boolean {
  return existsSync(path);
}

async function startHealth(host: string, port: number, getSnapshot: () => SnapshotJson | null): Promise<void> {
  const creToken = process.env.CRE_ACT_TOKEN ?? "";
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    res.setHeader("Content-Type", "application/json");

    if (req.method === "GET" && url.startsWith("/cre/snapshot")) {
      const snap = getSnapshot();
      if (!snap) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: "snapshot not ready" }));
        return;
      }
      res.end(JSON.stringify(snap));
      return;
    }

    if (req.method === "POST" && url.startsWith("/cre/decision")) {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const auth = req.headers.authorization ?? "";
        const expected = creToken ? `Bearer ${creToken}` : "";
        if (!creToken || auth !== expected) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        let body: { kind?: string; reason?: string; targetNotional?: string };
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof body;
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "invalid json" }));
          return;
        }
        const kind = body.kind;
        const reason = typeof body.reason === "string" ? body.reason : "cre decision";
        if (kind !== "noop" && kind !== "crank" && kind !== "reduce" && kind !== "halt") {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "invalid kind" }));
          return;
        }
        const decision =
          kind === "reduce"
            ? {
                kind: "reduce" as const,
                targetNotional: BigInt(body.targetNotional ?? "0"),
                reason,
              }
            : { kind, reason };

        if (kind === "halt") {
          latchCreHalt(reason);
        }
        recordDecision(decision, true, undefined, "accepted via CRE HTTP act", "CRE");
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, creHaltLatched: isCreHaltLatched(), decision }));
      });
      return;
    }

    if (url.startsWith("/health")) {
      const body = healthPayload() as { ok: boolean };
      res.statusCode = body.ok ? 200 : 503;
      res.end(JSON.stringify(body));
      return;
    }
    if (url.startsWith("/last-decision")) {
      res.end(JSON.stringify((healthPayload() as { lastDecision: unknown }).lastDecision));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((r) => server.listen(port, host, r));
  console.log(`health on http://${host}:${port}/health`);
  if (creToken) console.log("CRE act endpoint armed at POST /cre/decision");
}

async function main(): Promise<void> {
  const chainId = Number(envOpt("PERPL_CHAIN_ID", "10143"));
  const apiUrl = envOpt("PERPL_API_URL", "https://testnet.perpl.xyz/api");
  const wsUrl = envOpt("PERPL_WS_URL", "wss://testnet.perpl.xyz");
  const marketId = Number(envOpt("PERPL_MARKET_ID", "64"));
  const killPath = envOpt("KILL_SWITCH_PATH", "./KILL");
  const maxNotional = BigInt(envOpt("MAX_NOTIONAL_PER_ACTION", "100000000"));
  const healthHost = envOpt("HEALTH_HOST", "0.0.0.0");
  const healthPort = Number(envOpt("HEALTH_PORT", process.env.PORT ?? "3001"));

  let lastSnapshot: SnapshotJson | null = null;
  await startHealth(healthHost, healthPort, () => lastSnapshot);

  const apiKey = process.env.PERPL_API_KEY ?? "";
  const secret = process.env.PERPL_API_KEY_SECRET ?? "";
  const hasPerpl = Boolean(apiKey && secret);

  const auth: AuthConfig | null = hasPerpl
    ? { chainId, apiKey, privateKey: parseSecretHex(secret), apiUrl }
    : null;

  if (!hasPerpl) {
    console.warn("PERPL_API_KEY / PERPL_API_KEY_SECRET unset — policy dry path only (no WS)");
  }

  const tradingBudget = new RequestBudget({ limitPerMin: 60, reservePerMin: 10 });
  const mdBudget = new RequestBudget({ limitPerMin: 10, reservePerMin: 2 });

  const rpc = process.env.MONAD_RPC_URL || process.env.RPC_URL;
  if (!rpc) throw new Error("MONAD_RPC_URL (paid/dedicated) required — do not poll public RPC");
  if (/testnet-rpc\.monad\.xyz/i.test(rpc) && !process.env.ALLOW_PUBLIC_RPC) {
    throw new Error("refusing public testnet-rpc.monad.xyz — set ALLOW_PUBLIC_RPC=1 to override");
  }

  const engine = loadEngineAddress();
  const pk = process.env.KEEPER_PK as `0x${string}` | undefined;
  const { publicClient, wallet, account } = clients(rpc, pk);

  let truth: Truth = { fills: [], positions: [], reconciledAt: 0 };
  let prevFunding = 0;
  let funding = 0;
  let retry = 0;
  let sn = 0;
  let rq = 0;
  let accountId = 0;
  let restingOid: number | null = null;
  let headBlock = 0;
  const orderTtl = 100;
  let trading: WsSocket | null = null;

  const md = new MarketDataClient(wsUrl, marketId, mdBudget);
  if (hasPerpl) {
    try {
      await md.connect();
    } catch (e) {
      console.warn("market-data connect failed", (e as Error).message);
    }
  }

  async function buildState(): Promise<KeeperState> {
    const eng = await readEngineState(publicClient, engine);
    let gasBudgetWei = 0n;
    if (account) {
      gasBudgetWei = await publicClient.getBalance({ address: account.address });
    } else if (dryRun) {
      gasBudgetWei = 10n ** 18n;
    }
    const book = md.getBook();
    const age = book.updatedAt ? Date.now() - book.updatedAt : Number.MAX_SAFE_INTEGER;
    let perplShort = shortNotionalFromPositions(truth.positions, marketId, book.bestAsk ?? 0, 0);
    if (perplShort === 0n) {
      for (const p of truth.positions) {
        if (p.mkt === marketId && p.s < 0) perplShort += BigInt(-p.s);
      }
    }
    return {
      spotInventoryWei: eng.spotInventoryWei,
      spotValueQuote: eng.spotValueQuote,
      perplShortNotional: perplShort,
      fundingRateMicros: funding,
      prevFundingRateMicros: prevFunding,
      exitDepthQuote: book.exitDepthQuote,
      deviationBandBps: 100,
      netDeltaBps: Math.abs(eng.netDeltaBps),
      capUtilisationBps: 0,
      lastCrankBlock: eng.lastCrankBlock,
      headBlock: eng.headBlock,
      crankIntervalBlocks: 1500n,
      gasBudgetWei,
      minGasBudgetWei: CRANK_GAS_LIMIT * 100n,
      marketDataAgeMs: hasPerpl ? age : 0,
      maxMarketDataAgeMs: 60_000,
      killSwitch: killSwitchArmed(killPath) || isCreHaltLatched(),
      maxNotionalPerAction: maxNotional,
    };
  }

  async function act(decision: Decision, state: KeeperState): Promise<void> {
    if (decision.kind === "crank") {
      if (dryRun || !wallet || !account) {
        recordDecision(decision, true, undefined, "crank dry-run or no KEEPER_PK");
        console.log("DECISION", decision);
        return;
      }
      const hash = await crankOnce(publicClient, wallet, account, engine);
      recordDecision(decision, false, hash);
      console.log("cranked", hash);
      return;
    }
    if (decision.kind === "reduce") {
      const result = executeDecision(
        decision,
        {
          dryRun,
          budget: tradingBudget,
          marketId,
          accountId,
          restingOrderId: restingOid,
          headBlock,
          orderTtlBlocks: orderTtl,
          nextSn: () => ++sn,
          nextRq: () => ++rq,
          send: (frame) => {
            const spend = tradingBudget.trySpend("ws-frame", true);
            if (!spend.ok) {
              console.warn("queued Change — budget");
              return;
            }
            trading?.send(JSON.stringify(frame));
          },
        },
        (n) => Number(n > 2n ** 31n ? 2n ** 31n : n),
        md.getBook().bestBid ?? 0,
      );
      recordDecision(
        decision,
        dryRun,
        result.kind === "dry_run" || result.kind === "sent" ? result.order.rq : undefined,
        result.kind,
      );
      console.log("DECISION", decision, result);
      return;
    }
    recordDecision(decision, dryRun);
    console.log("DECISION", decision, {
      spot: state.spotValueQuote.toString(),
      short: state.perplShortNotional.toString(),
    });
  }

  async function connectTrading(): Promise<void> {
    if (!auth) return;
    await new Promise<void>((resolveConn, reject) => {
      trading = new WebSocket(`${wsUrl}/ws/v1/trading`);
      const timer = setTimeout(() => {
        reject(new Error("idle timeout before sign-in — must sign within 10s on testnet"));
      }, 9_000);
      trading.on("open", async () => {
        try {
          const spend = tradingBudget.trySpend("signin");
          if (!spend.ok) throw new Error("budget blocked sign-in");
          const frame = await tradingWsSignInFrame(auth);
          trading!.send(JSON.stringify(frame));
          clearTimeout(timer);
          resolveConn();
        } catch (e) {
          clearTimeout(timer);
          reject(e);
        }
      });
      trading.on("message", (buf) => {
        let msg: {
          mt?: number;
          as?: Array<{ id: number; lfr: number }>;
          d?: unknown;
          h?: number;
        };
        try {
          msg = JSON.parse(String(buf));
        } catch {
          return;
        }
        if (msg.mt === 19 && msg.as?.[0]) {
          accountId = msg.as[0].id;
          rq = Math.max(rq, msg.as[0].lfr ?? 0);
        }
        if (msg.mt === 100 && typeof msg.h === "number") headBlock = msg.h;
        if (msg.mt === 23 && Array.isArray(msg.d) && msg.d[0]) {
          const o = msg.d[0] as { oid?: number };
          if (o.oid) restingOid = o.oid;
        }
        if (msg.mt === 25 && Array.isArray(msg.d)) {
          truth.fills = [...truth.fills, ...(msg.d as Fill[])];
        }
      });
      trading.on("close", async (code, reasonBuf) => {
        const reason = reasonBuf.toString();
        const rec = recoveryFor(code, reason, retry++);
        console.warn("trading closed", code, reason, rec);
        setHealth(false, `ws close ${code} ${rec.reason}`);
        try {
          truth = await reconcileAfterReconnect(auth, truth.fills);
        } catch (e) {
          console.warn("reconcile failed", (e as Error).message);
        }
        await new Promise((r) => setTimeout(r, jitter(rec.backoffMs)));
        try {
          await connectTrading();
          setHealth(true, "reconnected");
          retry = 0;
        } catch (e) {
          console.error("reconnect failed", (e as Error).message);
        }
      });
    });
  }

  if (auth) {
    try {
      const to = Date.now();
      const from = to - 3_600_000;
      const res = await fetch(`${apiUrl}/v1/market-data/${marketId}/funding/${from}-${to}`);
      if (res.ok) {
        const body = (await res.json()) as { d?: Array<{ rate: number }> };
        const last = body.d?.[body.d.length - 1];
        if (last) {
          prevFunding = funding;
          funding = last.rate;
        }
      }
    } catch {
      /* optional */
    }
    await connectTrading();
    try {
      truth = await reconcileAfterReconnect(auth, []);
      setHealth(true, "reconciled");
    } catch (e) {
      setHealth(false, `reconcile: ${(e as Error).message}`);
    }
  } else {
    setHealth(true, "policy-only (no Perpl key)");
  }

  async function tick(): Promise<void> {
    const state = await buildState();
    lastSnapshot = stateToSnapshot(state);
    await act(decide(state), state);
  }

  await tick();
  if (once) {
    md.close();
    // ws.WebSocket typing under NodeNext can collapse; call defensively.
    (trading as { close?: () => void } | null)?.close?.();
    process.exit(0);
  }

  // Event loop with sleep — NOT setInterval against public RPC.
  for (;;) {
    try {
      await tick();
      setHealth(true, "ok");
    } catch (e) {
      const msg = (e as Error).message;
      console.error("tick error", msg);
      setHealth(false, msg);
      if (msg.includes("429")) await new Promise((r) => setTimeout(r, 5_000));
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
