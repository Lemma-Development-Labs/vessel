"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { VesselContext } from "./context";
import {
  COPY,
  EMPTY_DECK,
  EMPTY_ENGINE,
  type DeckStats,
  type Toast,
  type VesselDataProvider,
  type WaterfallEvent,
} from "./provider";

const MOCK_ADDR = "0xA11CE00000000000000000000000000000000ace" as const;

export function MockVesselProvider({ children }: { children: ReactNode }) {
  const [dusdBalance, setDusd] = useState(0n);
  const [hullShares, setHullShares] = useState(0n);
  const [balShares, setBalShares] = useState(0n);
  const [deck, setDeck] = useState<DeckStats>(EMPTY_DECK);
  const [engine, setEngine] = useState(EMPTY_ENGINE);
  const [waterfall, setWaterfall] = useState<WaterfallEvent[]>([]);
  const [connected, setConnected] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [impaired] = useState(false);
  const [lastFaucet, setLastFaucet] = useState(0);
  const [minted, setMinted] = useState(0n);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((xs) => [...xs, { ...t, id }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((xs) => xs.filter((t) => t.id !== id));
  }, []);

  const faucet = useCallback(async () => {
    const now = Date.now();
    if (lastFaucet && now - lastFaucet < 3600_000) {
      push({ kind: "error", text: COPY.cooldown(Math.ceil((3600_000 - (now - lastFaucet)) / 1000)) });
      return;
    }
    if (minted + 100_000000n > 1_000_000000n) {
      push({ kind: "error", text: "Faucet lifetime cap 1,000 dUSD." });
      return;
    }
    setDusd((b) => b + 100_000000n);
    setMinted((m) => m + 100_000000n);
    setLastFaucet(now);
    push({ kind: "success", text: "Faucet: 100 dUSD" });
  }, [lastFaucet, minted, push]);

  const joinBallast = useCallback(
    async (assets: bigint) => {
      if (assets > dusdBalance) return;
      const newBal = deck.balTvl + assets;
      const newHull = deck.hullTvl;
      const sum = newHull + newBal;
      const bps = sum === 0n ? 10_000n : (newBal * 10_000n) / sum;
      if (bps < 2_000n) {
        push({ kind: "error", text: COPY.floor });
        return;
      }
      const shares = deck.balSupply === 0n ? assets * 1_000_000_000_000n : (assets * deck.balSupply) / deck.balTvl;
      setDusd((b) => b - assets);
      setBalShares((s) => s + shares);
      setDeck((d) => ({
        ...d,
        balTvl: newBal,
        balSupply: d.balSupply + shares,
        thetaBps: bps,
      }));
      push({ kind: "success", text: "Joined Ballast" });
    },
    [deck, dusdBalance, push],
  );

  const joinHull = useCallback(
    async (assets: bigint) => {
      if (assets > dusdBalance) return;
      const newHull = deck.hullTvl + assets;
      const newBal = deck.balTvl;
      const sum = newHull + newBal;
      const bps = sum === 0n ? 10_000n : (newBal * 10_000n) / sum;
      if (bps < 2_000n) {
        push({ kind: "error", text: COPY.floor });
        return;
      }
      const shares = deck.hullSupply === 0n ? assets * 1_000_000_000_000n : (assets * deck.hullSupply) / deck.hullTvl;
      setDusd((b) => b - assets);
      setHullShares((s) => s + shares);
      setDeck((d) => ({
        ...d,
        hullTvl: newHull,
        hullSupply: d.hullSupply + shares,
        thetaBps: bps,
      }));
      push({ kind: "success", text: "Joined Hull" });
    },
    [deck, dusdBalance, push],
  );

  const exitHull = useCallback(
    async (shares: bigint) => {
      if (shares === 0n || deck.hullSupply === 0n) return;
      const assets = (shares * deck.hullTvl) / deck.hullSupply;
      setHullShares((s) => s - shares);
      setDusd((b) => b + assets);
      const newHull = deck.hullTvl - assets;
      const newBal = deck.balTvl;
      const sum = newHull + newBal;
      setDeck((d) => ({
        ...d,
        hullTvl: newHull,
        hullSupply: d.hullSupply - shares,
        thetaBps: sum === 0n ? 10_000n : (newBal * 10_000n) / sum,
      }));
      push({ kind: "success", text: "Exited Hull" });
    },
    [deck, push],
  );

  const exitBallast = useCallback(
    async (shares: bigint) => {
      if (shares === 0n || deck.balSupply === 0n) return;
      const assets = (shares * deck.balTvl) / deck.balSupply;
      const newBal = deck.balTvl - assets;
      const newHull = deck.hullTvl;
      const sum = newHull + newBal;
      const oldBps = deck.thetaBps;
      const newBps = sum === 0n ? 10_000n : (newBal * 10_000n) / sum;
      if (newBps < 2_000n && newBps < oldBps) {
        push({ kind: "error", text: COPY.floor });
        return;
      }
      setBalShares((s) => s - shares);
      setDusd((b) => b + assets);
      setDeck((d) => ({
        ...d,
        balTvl: newBal,
        balSupply: d.balSupply - shares,
        thetaBps: newBps,
      }));
      push({ kind: "success", text: "Exited Ballast" });
    },
    [deck, push],
  );

  const crank = useCallback(async () => {
    if (impaired) {
      push({ kind: "error", text: COPY.impair });
      return;
    }
    const G = 2_000000n;
    const fee = (G * 1_000n) / 10_000n;
    const toReserve = fee / 2n;
    const toTreasury = fee - toReserve;
    const hullAccrual = G - fee > 500000n ? 500000n : G - fee;
    const toBallast = G - fee - hullAccrual;
    setDeck((d) => {
      const hullTvl = d.hullTvl + hullAccrual;
      const balTvl = d.balTvl + toBallast;
      const reserve = d.reserve + toReserve;
      const sum = hullTvl + balTvl;
      return {
        ...d,
        hullTvl,
        balTvl,
        reserve,
        treasuryAccrued: d.treasuryAccrued + toTreasury,
        lastSettle: BigInt(Math.floor(Date.now() / 1000)),
        thetaBps: sum === 0n ? 10_000n : (balTvl * 10_000n) / sum,
      };
    });
    const ev: WaterfallEvent = {
      gross: G,
      fee,
      toReserve,
      toTreasury,
      hullAccrual,
      toBallast,
      fromBallast: 0n,
      fromReserve: 0n,
      hullTvl: deck.hullTvl + hullAccrual,
      balTvl: deck.balTvl + toBallast,
      reserve: deck.reserve + toReserve,
      ts: BigInt(Math.floor(Date.now() / 1000)),
      txHash: `0xmock${Date.now().toString(16)}`,
    };
    setWaterfall((w) => [ev, ...w].slice(0, 24));
    setEngine((e) => ({ ...e, netDelta: 0n, netDeltaBps: 0n, shortId: 1n }));
    push({ kind: "success", text: "Cranked — waterfall from simulated venue" });
  }, [deck, impaired, push]);

  const deployLiquidity = useCallback(async () => {
    setEngine((e) => ({ ...e, shortId: 1n, netDelta: 0n, netDeltaBps: 0n }));
    push({ kind: "success", text: "Hedge deployed (simulated)" });
  }, [push]);

  const value = useMemo<VesselDataProvider>(
    () => ({
      dusdBalance,
      hullShares,
      balShares,
      deck,
      engine,
      waterfall,
      connected,
      address: connected ? MOCK_ADDR : undefined,
      chainId: 10143,
      wrongNetwork: false,
      reconnecting: false,
      paused: false,
      impaired,
      toasts,
      faucet,
      joinHull,
      joinBallast,
      exitHull,
      exitBallast,
      crank,
      deployLiquidity,
      connect: async () => setConnected(true),
      disconnect: async () => setConnected(false),
      switchNetwork: async () => {},
      dismissToast,
    }),
    [
      dusdBalance,
      hullShares,
      balShares,
      deck,
      engine,
      waterfall,
      connected,
      impaired,
      toasts,
      faucet,
      joinHull,
      joinBallast,
      exitHull,
      exitBallast,
      crank,
      deployLiquidity,
      dismissToast,
    ],
  );

  return <VesselContext.Provider value={value}>{children}</VesselContext.Provider>;
}
