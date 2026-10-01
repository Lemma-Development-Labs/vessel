"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ok, unavailable, type Live } from "../live";
import type { Toast } from "../copy";
import { BookContext } from "./context";
import { previewAssets } from "./plan";
import type {
  BookEvidence,
  BookHistoryRow,
  BookProvider,
  BookState,
  DepositRequest,
  EngineState,
  ExitRequest,
  Series,
  Wallet,
} from "./types";

/**
 * Demo provider for screenshots and browser tests (NEXT_PUBLIC_USE_MOCK=1).
 * Values are plain internally and lifted to `Live<T>` with `source: "mock"`
 * at the boundary, so the UI labels them as demo data, never as chain state.
 *
 * `?demo=` variants: empty · disconnected · notinvited · unwired · impair ·
 * paused · error · wrongnet.
 */

const ME = "0xA11CE00000000000000000000000000000000ace" as const;
const TX_MS = 1_200;
const d = (n: number) => BigInt(Math.round(n * 1e6));

type Raw = {
  now: bigint;
  block: bigint;
  book: BookState;
  engine: EngineState | null;
  series: Series[];
  wallet: Wallet;
  deposits: DepositRequest[];
  exits: ExitRequest[];
  history: BookHistoryRow[];
  nextDeposit: bigint;
  nextExit: bigint;
};

function seed(demo: string | null): Raw {
  // Relative to the moment the demo loads, so countdowns stay meaningful.
  const NOW0 = BigInt(Math.floor(Date.now() / 1000));
  const unwired = demo === "unwired";
  const empty = demo === "empty" || unwired;
  const book: BookState = unwired
    ? {
        hullNav: 0n, ballastNav: 0n, reserveNav: 0n, treasuryLiability: 0n, recordedActive: 0n, lossCarry: 0n, epoch: 0n,
        impaired: false, coverBps: 10_000n, stageCap: 0n, lifetimeAdmitted: 0n, pendingReserved: 0n, activeSeries: 0n,
        seriesCount: 0n, ballastSupply: 0n, virtualUnits: 10n ** 12n, virtualAssets: 1n, pausedMask: 0, engine: null,
        ballastQueue: 0n, exitQueue: 0n,
      }
    : {
        hullNav: d(4_000), ballastNav: d(2_600), reserveNav: d(132), treasuryLiability: d(3.1), recordedActive: d(6_732),
        lossCarry: 0n, epoch: 41n, impaired: demo === "impair", coverBps: 3_939n, stageCap: d(25_000),
        lifetimeAdmitted: d(6_600), pendingReserved: d(450), activeSeries: 2n, seriesCount: 2n,
        ballastSupply: d(2_540) * 10n ** 12n, virtualUnits: 10n ** 12n, virtualAssets: 1n,
        pausedMask: demo === "paused" ? 1 : 0, engine: "0x0137903a9308cC675c13E5aB935c27707eE4Be6A",
        ballastQueue: 9n, exitQueue: 3n,
      };
  const series: Series[] = unwired
    ? []
    : [
        {
          id: 1n, state: "CLAIMABLE", rateBps: 800n, termsHash: `0x${"7b".repeat(32)}`, subscriptionEnd: NOW0 - 32n * 86400n,
          activation: NOW0 - 31n * 86400n, maturity: NOW0 - 3n * 86400n, principal: d(3_000), recognizedCoupon: d(18.41),
          subscriptions: 7n, myUnits: empty ? 0n : d(500), myClaimable: empty ? 0n : d(503.07),
        },
        {
          id: 2n, state: "SUBSCRIPTION_OPEN", rateBps: 800n, termsHash: `0x${"7c".repeat(32)}`, subscriptionEnd: NOW0 + 41n * 3600n,
          activation: 0n, maturity: 0n, principal: 0n, recognizedCoupon: 0n, subscriptions: 4n, myUnits: 0n, myClaimable: 0n,
        },
      ];
  const wallet: Wallet = {
    dusd: d(empty ? 100 : 412.5),
    custodyAllowance: 0n,
    betaAllowance: demo === "notinvited" ? 0n : d(2_000),
    admitted: empty ? 0n : d(800),
    reserved: empty ? 0n : d(150),
    ballastUnits: empty ? 0n : d(240) * 10n ** 12n,
    ballastLocked: empty ? 0n : d(60) * 10n ** 12n,
    ballastValue: 0n,
    faucetCooldownSec: 0,
    faucetRemaining: d(empty ? 900 : 600),
  };
  wallet.ballastValue = previewAssets(wallet.ballastUnits + wallet.ballastLocked, book);
  const deposits: DepositRequest[] = empty
    ? []
    : [
        { id: 14n, owner: ME, receiver: ME, tranche: "hull", seriesId: 2n, deadline: NOW0 + 65n * 3600n, createdAt: NOW0 - 3600n, status: "ESCROWED", assets: d(150), minOut: 800n },
        { id: 9n, owner: ME, receiver: ME, tranche: "ballast", seriesId: 0n, deadline: NOW0 - 86400n, createdAt: NOW0 - 9n * 86400n, status: "ADMITTED", assets: d(300), minOut: 0n },
        { id: 6n, owner: ME, receiver: ME, tranche: "ballast", seriesId: 0n, deadline: NOW0 - 20n * 86400n, createdAt: NOW0 - 21n * 86400n, status: "REFUNDABLE", assets: d(50), minOut: 0n },
      ];
  const exits: ExitRequest[] = empty
    ? []
    : [
        { id: 3n, owner: ME, receiver: ME, requestedAt: NOW0 - 20n * 3600n, status: "COOLING", units: d(60) * 10n ** 12n, funded: 0n, claimable: 0n },
        { id: 1n, owner: ME, receiver: ME, requestedAt: NOW0 - 6n * 86400n, status: "FUNDED", units: 0n, funded: d(41.2), claimable: d(41.2) },
      ];
  const history: BookHistoryRow[] = unwired
    ? []
    : [
        { blockNumber: "67180012", txHash: `0x${"a1".repeat(32)}`, logIndex: 3, event: "EpochSettled", args: { gain: "4120000" }, finalized: false },
        { blockNumber: "67179440", txHash: `0x${"b2".repeat(32)}`, logIndex: 1, event: "DepositAdmitted", args: { id: "9", assets: "300000000" }, finalized: true },
        { blockNumber: "67171003", txHash: `0x${"c3".repeat(32)}`, logIndex: 0, event: "SeriesOpened", args: { seriesId: "2", rateBps: "800" }, finalized: true },
      ];
  return {
    now: NOW0, block: 67_180_020n, book, engine: unwired ? null : { simulated: true, value: d(5_700), fundingRateBps: 1_200n },
    series, wallet, deposits, exits, history, nextDeposit: 15n, nextExit: 4n,
  };
}

export function MockBookProvider({ demo, children }: { demo: string | null; children: ReactNode }) {
  const [raw, setRaw] = useState<Raw>(() => seed(demo));
  const [connected, setConnected] = useState(demo !== "disconnected");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const error = demo === "error";

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((xs) => [...xs, { ...t, id }]);
    return id;
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((xs) => xs.filter((t) => t.id !== id)), []);

  const tx = useCallback(
    (label: string, mutate: (r: Raw) => Raw) =>
      new Promise<boolean>((resolve) => {
        const p = push({ kind: "pending", text: `${label}…` });
        setTimeout(() => {
          setRaw((r) => mutate({ ...r, block: r.block + 3n }));
          dismissToast(p);
          push({ kind: "success", text: `${label} confirmed` });
          resolve(true);
        }, TX_MS);
      }),
    [dismissToast, push],
  );

  const value = useMemo<BookProvider>(() => {
    const at = Number(raw.now);
    const M = <T,>(v: T): Live<T> => (error ? unavailable("demo: RPC reconnecting") : ok(v, "mock", at));
    const needWallet = <T,>(v: T): Live<T> => (connected ? M(v) : unavailable("connect a wallet to see your position"));
    const evidence: BookEvidence = {
      status: raw.engine ? "SIMULATED" : "LIVE",
      blockNumber: raw.block.toString(),
      blockHash: `0x${"5e".repeat(32)}`,
      checks: [
        { id: "book.identity", verdict: "PASS", summary: "recorded A equals H + B + R" },
        { id: "custody.backing", verdict: "PASS", summary: "custody holds at least pending + active idle" },
        { id: "escrow.backing", verdict: "PASS", summary: "claim escrow backs every funded claim" },
        { id: "caps.lifetime", verdict: "PASS", summary: "admitted + reserved within the stage cap and the V1 ceiling" },
        { id: "engine", verdict: raw.engine ? "SIMULATED" : "INFO", summary: raw.engine ? "engine is SIMULATED (testnet)" : "no engine wired" },
      ],
    };
    return {
      clock: M({ number: raw.block, timestamp: raw.now }),
      book: M(raw.book),
      engine: M(raw.engine),
      series: M(raw.series),
      wallet: needWallet(raw.wallet),
      myDeposits: needWallet(raw.deposits),
      myExits: needWallet(raw.exits),
      history: M(raw.history),
      evidence: M(evidence),

      loading: false,
      connected,
      address: connected ? ME : undefined,
      wrongNetwork: demo === "wrongnet",
      reconnecting: error,
      isMock: true,
      toasts,
      connectors: [{ id: "mock", name: "Demo wallet", ready: true }],

      faucet: () =>
        tx("Faucet", (r) => ({
          ...r,
          wallet: { ...r.wallet, dusd: r.wallet.dusd + d(100), faucetRemaining: r.wallet.faucetRemaining - d(100), faucetCooldownSec: 3600 },
        })),
      requestDeposit: ({ tranche, seriesId, assets, minOut, deadline }) =>
        tx(tranche === "hull" ? "Subscribe to Hull" : "Request Ballast deposit", (r) => ({
          ...r,
          nextDeposit: r.nextDeposit + 1n,
          wallet: { ...r.wallet, dusd: r.wallet.dusd - assets, reserved: r.wallet.reserved + assets },
          book: { ...r.book, pendingReserved: r.book.pendingReserved + assets },
          series: r.series.map((s) => (s.id === seriesId && tranche === "hull" ? { ...s, subscriptions: s.subscriptions + 1n } : s)),
          deposits: [
            { id: r.nextDeposit, owner: ME, receiver: ME, tranche, seriesId, deadline, createdAt: r.now, status: "ESCROWED", assets, minOut },
            ...r.deposits,
          ],
        })),
      cancelDeposit: (id) =>
        tx("Cancel request", (r) => {
          const dep = r.deposits.find((x) => x.id === id);
          if (!dep) return r;
          return {
            ...r,
            wallet: { ...r.wallet, reserved: r.wallet.reserved - dep.assets },
            book: { ...r.book, pendingReserved: r.book.pendingReserved - dep.assets },
            deposits: r.deposits.map((x) => (x.id === id ? { ...x, status: "REFUNDABLE" } : x)),
          };
        }),
      claimRefund: (id) =>
        tx("Claim refund", (r) => {
          const dep = r.deposits.find((x) => x.id === id);
          if (!dep) return r;
          return {
            ...r,
            wallet: { ...r.wallet, dusd: r.wallet.dusd + dep.assets },
            deposits: r.deposits.map((x) => (x.id === id ? { ...x, status: "REFUNDED" } : x)),
          };
        }),
      requestRedeem: (units) =>
        tx("Request Ballast exit", (r) => ({
          ...r,
          nextExit: r.nextExit + 1n,
          wallet: { ...r.wallet, ballastUnits: r.wallet.ballastUnits - units, ballastLocked: r.wallet.ballastLocked + units },
          exits: [{ id: r.nextExit, owner: ME, receiver: ME, requestedAt: r.now, status: "COOLING", units, funded: 0n, claimable: 0n }, ...r.exits],
        })),
      cancelRedeem: (id) =>
        tx("Cancel exit", (r) => {
          const e = r.exits.find((x) => x.id === id);
          if (!e) return r;
          return {
            ...r,
            wallet: { ...r.wallet, ballastUnits: r.wallet.ballastUnits + e.units, ballastLocked: r.wallet.ballastLocked - e.units },
            exits: r.exits.map((x) => (x.id === id ? { ...x, status: "CANCELLED", units: 0n } : x)),
          };
        }),
      claimExit: (id) =>
        tx("Claim exit", (r) => {
          const e = r.exits.find((x) => x.id === id);
          if (!e) return r;
          return {
            ...r,
            wallet: { ...r.wallet, dusd: r.wallet.dusd + e.claimable },
            exits: r.exits.map((x) => (x.id === id ? { ...x, claimable: 0n } : x)),
          };
        }),
      claimHull: (sid) =>
        tx("Claim Hull payout", (r) => {
          const s = r.series.find((x) => x.id === sid);
          if (!s) return r;
          return {
            ...r,
            wallet: { ...r.wallet, dusd: r.wallet.dusd + s.myClaimable },
            series: r.series.map((x) => (x.id === sid ? { ...x, myClaimable: 0n } : x)),
          };
        }),

      connect: async () => setConnected(true),
      disconnect: async () => setConnected(false),
      switchNetwork: async () => undefined,
      dismissToast,
    };
  }, [connected, demo, dismissToast, error, raw, toasts, tx]);

  return <BookContext.Provider value={value}>{children}</BookContext.Provider>;
}

