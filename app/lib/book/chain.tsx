"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { WaitForTransactionReceiptTimeoutError, encodeAbiParameters, keccak256, type Abi } from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { decodeVesselError } from "../errors";
import { gasFor } from "../gas";
import { ok, unavailable, type Live } from "../live";
import type { Toast } from "../copy";
import { statsUrl } from "../stats";
import { EXPLORER, TARGET_CHAIN_ID, vesselChain } from "../wagmi";
import { BookContext } from "./context";
import { V2 } from "./release";
import { RECONCILE_GIVE_UP_SEC, forgetPending, pendingFor, rememberPending, type PendingTx } from "./pending";
import {
  EXIT_STATUSES,
  REQ_STATUSES,
  SERIES_STATES,
  type BookEvidence,
  type BookHistoryRow,
  type BookProvider,
  type BookState,
  type DepositRequest,
  type EngineState,
  type ExitRequest,
  type Series,
  type Wallet,
} from "./types";
import controllerJson from "./abis/TrancheController.json";
import escrowJson from "./abis/ClaimEscrow.json";
import ballastJson from "./abis/BallastToken.json";
import pausesJson from "./abis/PauseGuardian.json";
import engineJson from "./abis/SimulatedEngine.json";
import dusdJson from "./abis/DemoUSD.json";
import custodyJson from "./abis/AssetCustody.json";

const controllerAbi = controllerJson as Abi;
const escrowAbi = escrowJson as Abi;
const ballastAbi = ballastJson as Abi;
const pausesAbi = pausesJson as Abi;
const engineAbi = engineJson as Abi;
const dusdAbi = dusdJson as Abi;
const custodyAbi = custodyJson as Abi;

const C = V2.TrancheController as `0x${string}`;
const ZERO = "0x0000000000000000000000000000000000000000";

/** Request ids scanned per read. The beta is capped (25 subscribers a series, invited wallets). */
const SCAN = 400n;
/** DemoUSD faucet constants (compile-time in the contract). */
const FAUCET_COOLDOWN = 3_600n;
const FAUCET_CAP = 1_000_000_000n;

/** Gas ceilings, used only when the node cannot estimate (Monad bills the limit; see lib/gas.ts). */
const CEIL = {
  faucet: 200_000n,
  approve: 90_000n,
  request: 600_000n,
  cancel: 250_000n,
  claim: 250_000n,
} as const;

export const exitKey = (id: bigint) =>
  keccak256(encodeAbiParameters([{ type: "string" }, { type: "uint256" }], ["VESSEL_EXIT", id]));

type Entry = { status: "success"; result: unknown } | { status: "failure"; error?: unknown };

/** Pull a typed result or throw — the whole group then becomes unavailable with this reason. */
function need<T>(e: Entry | undefined, what: string): T {
  if (!e || e.status !== "success" || e.result === undefined || e.result === null) {
    throw new Error(`${what} — call reverted or not returned`);
  }
  return e.result as T;
}

function range(from: bigint, toExclusive: bigint): bigint[] {
  const out: bigint[] = [];
  for (let i = from; i < toExclusive; i++) out.push(i);
  return out;
}

type Snapshot = {
  clock: { number: bigint; timestamp: bigint };
  book: Live<BookState>;
  engine: Live<EngineState | null>;
  series: Live<Series[]>;
  wallet: Live<Wallet>;
  myDeposits: Live<DepositRequest[]>;
  myExits: Live<ExitRequest[]>;
};

export function ChainBookProvider({ children }: { children: ReactNode }) {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const pc = usePublicClient();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const wrongNetwork = isConnected && chainId !== TARGET_CHAIN_ID;

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((xs) => [...xs, { ...t, id }]);
    return id;
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((xs) => xs.filter((t) => t.id !== id)), []);

  const reads = useQuery({
    queryKey: ["book", address],
    enabled: !!pc,
    placeholderData: keepPreviousData,
    refetchInterval: 6_000,
    queryFn: async (): Promise<Snapshot> => {
      if (!pc) throw new Error("rpc");
      // One block for every read, so the page never mixes two states of the book.
      const block = await pc.getBlock({ blockTag: "latest" });
      const blockNumber = block.number;
      const asOf = Number(block.timestamp);
      // viem's default 1 KB chunks would turn a 400-request scan into 30+ RPC calls per refresh,
      // past the public RPC's per-second cap; ~8 KB (~220 reads, a few M gas) keeps it to a handful.
      const mc = (contracts: readonly unknown[]) =>
        pc.multicall({ contracts: contracts as never, allowFailure: true, blockNumber, batchSize: 8_192 }) as Promise<Entry[]>;
      const ctl = (functionName: string, args: readonly unknown[] = []) => ({ address: C, abi: controllerAbi, functionName, args });

      const BOOK = [
        "hullNav", "ballastNav", "reserveNav", "treasuryLiability", "lastActive", "lossCarry", "epoch", "impaired",
        "juniorCoverBps", "stageCap", "lifetimeAdmitted", "pendingReserved", "activeSeries", "seriesCount", "engine",
        "queueLengths", "virtualUnits", "virtualAssets", "nextDepositId", "nextExitId", "closeCost", "maxValuationAge",
      ] as const;
      const first = await mc([
        ...BOOK.map((f) => ctl(f)),
        { address: V2.BallastToken, abi: ballastAbi, functionName: "totalSupply" },
        { address: V2.PauseGuardian, abi: pausesAbi, functionName: "pausedMask" },
        { address: V2.AssetCustody, abi: custodyAbi, functionName: "pending" },
        { address: V2.AssetCustody, abi: custodyAbi, functionName: "activeIdle" },
        { address: V2.ClaimEscrow, abi: escrowAbi, functionName: "totalFunded" },
        ...(address
          ? [
              { address: V2.DemoUSD, abi: dusdAbi, functionName: "balanceOf", args: [address] },
              { address: V2.DemoUSD, abi: dusdAbi, functionName: "allowance", args: [address, V2.AssetCustody] },
              ctl("allowanceOf", [address]),
              ctl("admittedOf", [address]),
              ctl("reservedOf", [address]),
              { address: V2.BallastToken, abi: ballastAbi, functionName: "balanceOf", args: [address] },
              { address: V2.BallastToken, abi: ballastAbi, functionName: "lockedOf", args: [address] },
              { address: V2.DemoUSD, abi: dusdAbi, functionName: "lastFaucetAt", args: [address] },
              { address: V2.DemoUSD, abi: dusdAbi, functionName: "mintedLifetime", args: [address] },
            ]
          : []),
      ]);
      const at = (name: (typeof BOOK)[number]) => first[BOOK.indexOf(name)];

      let book: Live<BookState>;
      let nextDeposit = 1n;
      let nextExit = 1n;
      let seriesCount = 0n;
      let engineAddr: `0x${string}` | null = null;
      try {
        const q = need<readonly [bigint, bigint]>(at("queueLengths"), "queue lengths");
        const eng = need<`0x${string}`>(at("engine"), "engine address");
        engineAddr = eng === ZERO ? null : eng;
        seriesCount = need<bigint>(at("seriesCount"), "series count");
        nextDeposit = need<bigint>(at("nextDepositId"), "request counter");
        nextExit = need<bigint>(at("nextExitId"), "exit counter");
        book = ok(
          {
            hullNav: need(at("hullNav"), "Hull NAV"),
            ballastNav: need(at("ballastNav"), "Ballast NAV"),
            reserveNav: need(at("reserveNav"), "reserve"),
            treasuryLiability: need(at("treasuryLiability"), "treasury liability"),
            recordedActive: need(at("lastActive"), "recorded active assets"),
            lossCarry: need(at("lossCarry"), "loss carryforward"),
            epoch: need(at("epoch"), "epoch"),
            impaired: need(at("impaired"), "impairment flag"),
            coverBps: need(at("juniorCoverBps"), "junior cover"),
            stageCap: need(at("stageCap"), "stage cap"),
            lifetimeAdmitted: need(at("lifetimeAdmitted"), "lifetime admitted"),
            pendingReserved: need(at("pendingReserved"), "pending reserved"),
            activeSeries: need(at("activeSeries"), "active series"),
            seriesCount,
            engine: engineAddr,
            ballastQueue: q[0],
            exitQueue: q[1],
            virtualUnits: need(at("virtualUnits"), "virtual units"),
            virtualAssets: need(at("virtualAssets"), "virtual assets"),
            ballastSupply: need(first[BOOK.length], "Ballast supply"),
            pausedMask: Number(need<number | bigint>(first[BOOK.length + 1], "pause state")),
            custodyPending: need(first[BOOK.length + 2], "custody pending"),
            activeIdle: need(first[BOOK.length + 3], "idle cash"),
            escrowFunded: need(first[BOOK.length + 4], "escrow funded"),
            closeCost: need(at("closeCost"), "close cost"),
            maxValuationAge: need(at("maxValuationAge"), "max valuation age"),
          },
          "chain",
          asOf,
        );
      } catch (err) {
        book = unavailable(err instanceof Error ? err.message : "book read failed");
      }

      const w0 = BOOK.length + 5;
      let walletBase: Omit<Wallet, "ballastValue"> | null = null;
      let wallet: Live<Wallet> = unavailable(address ? "wallet read failed" : "connect a wallet to see your position");
      if (address) {
        try {
          const last = need<bigint>(first[w0 + 7], "faucet timestamp");
          const minted = need<bigint>(first[w0 + 8], "faucet minted");
          const readyAt = last === 0n ? 0n : last + FAUCET_COOLDOWN;
          walletBase = {
            dusd: need(first[w0], "dUSD balance"),
            custodyAllowance: need(first[w0 + 1], "dUSD allowance"),
            betaAllowance: need(first[w0 + 2], "beta allowance"),
            admitted: need(first[w0 + 3], "admitted"),
            reserved: need(first[w0 + 4], "reserved"),
            ballastUnits: need(first[w0 + 5], "Ballast units"),
            ballastLocked: need(first[w0 + 6], "locked Ballast units"),
            faucetCooldownSec: readyAt > block.timestamp ? Number(readyAt - block.timestamp) : 0,
            faucetRemaining: minted >= FAUCET_CAP ? 0n : FAUCET_CAP - minted,
          };
        } catch (err) {
          wallet = unavailable(err instanceof Error ? err.message : "wallet read failed");
        }
      }

      // Second round: series, engine, the caller's requests and Hull positions.
      const seriesIds = range(seriesCount > 20n ? seriesCount - 19n : 1n, seriesCount + 1n);
      const depIds = address ? range(nextDeposit > SCAN ? nextDeposit - SCAN : 1n, nextDeposit) : [];
      const exitIds = address ? range(nextExit > SCAN ? nextExit - SCAN : 1n, nextExit) : [];
      const units = walletBase?.ballastUnits ?? 0n; // rule0-ok: call argument; the wallet group is unavailable when unread
      const second = await mc([
        ...seriesIds.map((id) => ctl("seriesInfo", [id])),
        ...(address ? seriesIds.flatMap((id) => [ctl("hullUnits", [id, address]), ctl("hullClaimable", [id, address])]) : []),
        ...depIds.map((id) => ctl("deposits", [id])),
        ...exitIds.map((id) => ctl("exits", [id])),
        ...(engineAddr
          ? [
              { address: engineAddr, abi: engineAbi, functionName: "isSimulated" },
              { address: engineAddr, abi: engineAbi, functionName: "value" },
              { address: engineAddr, abi: engineAbi, functionName: "fundingRateBps" },
            ]
          : []),
        ...(address ? [ctl("ballastUnitValue", [units])] : []),
      ]);
      let k = 0;
      const take = (n: number) => second.slice(k, (k += n));
      const sInfo = take(seriesIds.length);
      const sMine = address ? take(seriesIds.length * 2) : [];
      const dRows = take(depIds.length);
      const eRows = take(exitIds.length);
      const eng = engineAddr ? take(3) : [];
      const unitVal = address ? take(1)[0] : undefined;

      let series: Live<Series[]>;
      try {
        series = ok(
          seriesIds.map((id, i) => {
            const r = need<readonly [number, bigint, `0x${string}`, bigint, bigint, bigint, bigint, bigint, bigint, bigint]>(
              sInfo[i],
              `series ${id}`,
            );
            return {
              id,
              state: SERIES_STATES[r[0]] ?? "NONE",
              rateBps: r[1],
              termsHash: r[2],
              subscriptionEnd: r[3],
              activation: r[4],
              maturity: r[5],
              principal: r[6],
              recognizedCoupon: r[7],
              subscriptions: r[9],
              myUnits: address ? need<bigint>(sMine[i * 2], `your units in series ${id}`) : 0n,
              myClaimable: address ? need<bigint>(sMine[i * 2 + 1], `your claim in series ${id}`) : 0n,
            };
          }),
          "chain",
          asOf,
        );
      } catch (err) {
        series = unavailable(err instanceof Error ? err.message : "series read failed");
      }

      let engine: Live<EngineState | null>;
      if (!engineAddr) engine = ok(null, "chain", asOf);
      else {
        try {
          const v = need<readonly [bigint, bigint]>(eng[1], "engine value");
          engine = ok(
            { simulated: need<boolean>(eng[0], "engine simulation flag"), value: v[0], observedAt: v[1], fundingRateBps: need<bigint>(eng[2], "funding rate") },
            "chain",
            asOf,
          );
        } catch (err) {
          engine = unavailable(err instanceof Error ? err.message : "engine read failed");
        }
      }

      let myDeposits: Live<DepositRequest[]> = unavailable("connect a wallet to see your requests");
      let myExits: Live<ExitRequest[]> = unavailable("connect a wallet to see your exits");
      if (address) {
        const me = address.toLowerCase();
        try {
          const rows: DepositRequest[] = [];
          depIds.forEach((id, i) => {
            const r = need<readonly [`0x${string}`, `0x${string}`, number, bigint, bigint, bigint, number, bigint, bigint]>(dRows[i], `request ${id}`);
            if (r[0].toLowerCase() !== me) return;
            rows.push({
              id, owner: r[0], receiver: r[1], tranche: r[2] === 0 ? "hull" : "ballast", seriesId: r[3], deadline: r[4],
              createdAt: r[5], status: REQ_STATUSES[r[6]] ?? "NONE", assets: r[7], minOut: r[8],
            });
          });
          myDeposits = ok(rows.reverse(), "chain", asOf);
        } catch (err) {
          myDeposits = unavailable(err instanceof Error ? err.message : "request read failed");
        }
        try {
          const mine: Omit<ExitRequest, "claimable">[] = [];
          exitIds.forEach((id, i) => {
            const r = need<readonly [`0x${string}`, `0x${string}`, bigint, number, bigint, bigint, bigint]>(eRows[i], `exit ${id}`);
            if (r[0].toLowerCase() !== me) return;
            mine.push({ id, owner: r[0], receiver: r[1], requestedAt: r[2], status: EXIT_STATUSES[r[3]] ?? "NONE", units: r[4], funded: r[6] });
          });
          // Escrow balance per exit — what the receiver can claim now.
          const pools = mine.length
            ? await mc(mine.map((e) => ({ address: V2.ClaimEscrow, abi: escrowAbi, functionName: "poolBalance", args: [exitKey(e.id)] })))
            : [];
          myExits = ok(
            mine.map((e, i) => ({ ...e, claimable: need<bigint>(pools[i], `escrow for exit ${e.id}`) })).reverse(),
            "chain",
            asOf,
          );
        } catch (err) {
          myExits = unavailable(err instanceof Error ? err.message : "exit read failed");
        }
        if (walletBase) {
          try {
            wallet = ok({ ...walletBase, ballastValue: need<bigint>(unitVal, "Ballast value") }, "chain", asOf);
          } catch (err) {
            wallet = unavailable(err instanceof Error ? err.message : "Ballast value read failed");
          }
        }
      }

      return { clock: { number: blockNumber, timestamp: block.timestamp }, book, engine, series, wallet, myDeposits, myExits };
    },
  });

  const api = statsUrl();
  const evidence = useQuery({
    queryKey: ["book-evidence", api],
    enabled: !!api,
    refetchInterval: 15_000,
    queryFn: async (): Promise<{ evidence: Live<BookEvidence>; history: Live<BookHistoryRow[]> }> => {
      const now = Math.floor(Date.now() / 1000);
      const get = async (path: string) => {
        const r = await fetch(`${api}${path}`, { cache: "no-store" });
        const body = (await r.json()) as Record<string, unknown>;
        return { okStatus: r.ok, body };
      };
      let ev: Live<BookEvidence>;
      let hist: Live<BookHistoryRow[]>;
      try {
        const { okStatus, body } = await get("/v1/book");
        ev = okStatus
          ? ok(
              {
                status: body.status as BookEvidence["status"],
                blockNumber: (body.blockNumber as string | null) ?? null,
                blockHash: (body.blockHash as string | null) ?? null,
                checks: (body.checks as BookEvidence["checks"]) ?? [],
              },
              "stats",
              now,
            )
          : unavailable(`independent check — ${String(body.reason ?? body.error ?? "service unavailable")}`);
      } catch {
        ev = unavailable("independent check — service unreachable");
      }
      try {
        const { okStatus, body } = await get("/v1/history?limit=50");
        hist = okStatus
          ? ok((body.data as BookHistoryRow[]) ?? [], "stats", now)
          : unavailable(`event history — ${String(body.reason ?? body.error ?? "service unavailable")}`);
      } catch {
        hist = unavailable("event history — service unreachable");
      }
      return { evidence: ev, history: hist };
    },
  });

  const explorerTx = (hash: string) => (EXPLORER ? `${EXPLORER}/tx/${hash}` : undefined);
  /**
   * Wait for a submitted transaction that has outlived the normal wait (or a
   * reload). It keeps a pending toast — unknown is not failed, so nothing here
   * invites a resend — and gives up with an explorer pointer after
   * RECONCILE_GIVE_UP_SEC.
   */
  const watchPending = useCallback(
    (tx: PendingTx, text: string) => {
      const age = Math.floor(Date.now() / 1000) - tx.submittedAt;
      if (age > RECONCILE_GIVE_UP_SEC) {
        forgetPending(tx.hash);
        push({ kind: "info", text: `${tx.label}: no receipt after ${Math.round(age / 60)} min — check the explorer before sending again`, href: explorerTx(tx.hash) });
        return;
      }
      const toast = push({ kind: "pending", text });
      void pc
        ?.waitForTransactionReceipt({ hash: tx.hash, timeout: (RECONCILE_GIVE_UP_SEC - age) * 1000 })
        .then(async (r) => {
          forgetPending(tx.hash);
          dismissToast(toast);
          push(
            r.status === "success"
              ? { kind: "success", text: `${tx.label} confirmed`, href: explorerTx(tx.hash) }
              : { kind: "error", text: `${tx.label} reverted`, href: explorerTx(tx.hash) },
          );
          await reads.refetch();
        })
        .catch(() => {
          dismissToast(toast);
          push({ kind: "info", text: `${tx.label}: still no receipt — check the explorer before sending again`, href: explorerTx(tx.hash) });
        });
    },
    [dismissToast, pc, push, reads],
  );

  const runTx = useCallback(
    async (label: string, fn: () => Promise<`0x${string}`>): Promise<boolean> => {
      const pending = push({ kind: "pending", text: `${label}…` });
      let tx: PendingTx | undefined;
      try {
        const hash = await fn();
        tx = { hash, label, chainId: TARGET_CHAIN_ID, account: address ?? "", submittedAt: Math.floor(Date.now() / 1000) };
        // Remembered before waiting, so a reload mid-confirmation reconciles instead of forgetting.
        if (address) rememberPending(tx);
        const receipt = await pc?.waitForTransactionReceipt({ hash, timeout: 120_000 });
        forgetPending(hash);
        if (receipt && receipt.status !== "success") throw new Error("transaction reverted");
        dismissToast(pending);
        push({ kind: "success", text: `${label} confirmed`, href: explorerTx(hash) });
        await reads.refetch();
        return true;
      } catch (err) {
        dismissToast(pending);
        if (tx && err instanceof WaitForTransactionReceiptTimeoutError) {
          // Unknown is not failed: the transaction may still land. Keep watching; never invite a resend.
          watchPending(tx, `${label} — still confirming; do not send it again`);
          return false;
        }
        const text = decodeVesselError(err);
        if (text) push({ kind: "error", text });
        return false;
      }
    },
    [address, dismissToast, pc, push, reads, watchPending],
  );

  // On load (and wallet change): reconcile transactions submitted before a reload.
  const reconciling = useRef(new Set<string>());
  useEffect(() => {
    if (!pc || !address) return;
    const restore = async () => {
      await Promise.resolve(); // state updates run after the effect, not inside it
      for (const tx of pendingFor(address, TARGET_CHAIN_ID)) {
        if (reconciling.current.has(tx.hash)) continue;
        reconciling.current.add(tx.hash);
        watchPending(tx, `${tx.label} — confirming (restored after reload)…`);
      }
    };
    void restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pc, address]);

  /** Estimate against the connected account, +10%, ceiling-capped (lib/gas.ts). */
  const send = useCallback(
    async (to: `0x${string}`, abi: Abi, functionName: string, args: readonly unknown[], ceiling: bigint) => {
      if (!pc || !address) throw new Error("connect a wallet first");
      const gas = await gasFor(
        () => pc.estimateContractGas({ address: to, abi, functionName, args: args as never, account: address }),
        ceiling,
      );
      return writeContractAsync({ address: to, abi, functionName, args: args as never, gas });
    },
    [address, pc, writeContractAsync],
  );

  const value = useMemo<BookProvider>(() => {
    const d = reads.data;
    const down = "RPC read did not return";
    const ev = evidence.data;
    const noApi = "no evidence service configured (NEXT_PUBLIC_STATS_URL)";
    return {
      clock: d ? ok(d.clock, "chain", Number(d.clock.timestamp)) : unavailable(`chain clock — ${down}`),
      book: d?.book ?? unavailable(`book — ${down}`),
      engine: d?.engine ?? unavailable(`engine — ${down}`),
      series: d?.series ?? unavailable(`series — ${down}`),
      wallet: d?.wallet ?? unavailable(address ? `wallet — ${down}` : "connect a wallet to see your position"),
      myDeposits: d?.myDeposits ?? unavailable(`requests — ${down}`),
      myExits: d?.myExits ?? unavailable(`exits — ${down}`),
      evidence: ev?.evidence ?? unavailable(api ? "independent check — loading" : noApi),
      history: ev?.history ?? unavailable(api ? "event history — loading" : noApi),

      loading: reads.isLoading && !reads.data,
      connected: isConnected,
      address,
      wrongNetwork,
      reconnecting: reads.isError,
      isMock: false,
      toasts,
      connectors: connectors.map((c) => ({ id: c.id, name: c.name, ready: true })),

      faucet: () => runTx("Faucet", () => send(V2.DemoUSD, dusdAbi, "faucet", [], CEIL.faucet)),
      requestDeposit: ({ tranche, seriesId, assets, minOut, deadline }) =>
        runTx(tranche === "hull" ? "Subscribe to Hull" : "Request Ballast deposit", async () => {
          if (!pc || !address) throw new Error("connect a wallet first");
          const allowance = (await pc.readContract({
            address: V2.DemoUSD, abi: dusdAbi, functionName: "allowance", args: [address, V2.AssetCustody],
          })) as bigint;
          if (allowance < assets) {
            const h = await send(V2.DemoUSD, dusdAbi, "approve", [V2.AssetCustody, assets], CEIL.approve);
            await pc.waitForTransactionReceipt({ hash: h });
          }
          return send(C, controllerAbi, "requestDeposit", [tranche === "hull" ? 0 : 1, seriesId, assets, address, minOut, deadline], CEIL.request);
        }),
      cancelDeposit: (id) => runTx("Cancel request", () => send(C, controllerAbi, "cancelDeposit", [id], CEIL.cancel)),
      claimRefund: (id) => runTx("Claim refund", () => send(C, controllerAbi, "claimRefund", [id], CEIL.claim)),
      requestRedeem: (units, minAssets) =>
        runTx("Request Ballast exit", () => {
          if (!address) throw new Error("connect a wallet first");
          return send(C, controllerAbi, "requestBallastRedeem", [units, address, minAssets], CEIL.request);
        }),
      cancelRedeem: (id) => runTx("Cancel exit", () => send(C, controllerAbi, "cancelRedeem", [id], CEIL.cancel)),
      claimExit: (id) => runTx("Claim exit", () => send(V2.ClaimEscrow, escrowAbi, "claim", [exitKey(id)], CEIL.claim)),
      claimHull: (sid) => runTx("Claim Hull payout", () => send(C, controllerAbi, "claimHull", [sid], CEIL.claim)),

      connect: async (connectorId?: string) => {
        try {
          const c = connectorId ? connectors.find((x) => x.id === connectorId) : connectors[0];
          if (c) await connectAsync({ connector: c, chainId: TARGET_CHAIN_ID });
        } catch {
          /* wallet reject is quiet */
        }
      },
      disconnect: async () => disconnect(),
      switchNetwork: async () => {
        try {
          await switchChainAsync({ chainId: TARGET_CHAIN_ID });
        } catch {
          try {
            const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
            await eth?.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: `0x${TARGET_CHAIN_ID.toString(16)}`,
                  chainName: vesselChain.name,
                  nativeCurrency: vesselChain.nativeCurrency,
                  rpcUrls: [vesselChain.rpcUrls.default.http[0]],
                  blockExplorerUrls: vesselChain.blockExplorers ? [vesselChain.blockExplorers.default.url] : [],
                },
              ],
            });
          } catch {
            /* user rejected add-chain */
          }
        }
      },
      dismissToast,
    };
  }, [
    address, api, connectAsync, connectors, disconnect, dismissToast, evidence.data, isConnected, pc,
    reads.data, reads.isError, reads.isLoading, runTx, send, switchChainAsync, toasts, wrongNetwork,
  ]);

  return <BookContext.Provider value={value}>{children}</BookContext.Provider>;
}
