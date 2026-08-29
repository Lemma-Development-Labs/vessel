"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { MIN_JOIN } from "./gas";
import { VesselContext } from "./context";
import {
  COPY,
  EMPTY_META,
  thetaWouldHold,
  type DeckKind,
  type DeckStats,
  type EngineView,
  type PositionMeta,
  type Toast,
  type VesselDataProvider,
  type WaterfallEvent,
} from "./provider";

const MOCK_ADDR = "0xA11CE00000000000000000000000000000000ace" as const;
const TX_MS = 1_800;

function dusd(n: number): bigint {
  return BigInt(Math.round(n * 1e6));
}

function spark(seed: number, n = 24): number[] {
  const out: number[] = [];
  let v = seed;
  for (let i = 0; i < n; i++) {
    v += Math.sin(i / 3) * 0.15 + (i % 5) * 0.02;
    out.push(Number(v.toFixed(3)));
  }
  return out;
}

function fakeHash(): string {
  return `0xmock${Date.now().toString(16)}`;
}

const SEEDED_DECK: DeckStats = {
  hullTvl: dusd(41_250),
  balTvl: dusd(12_930.55),
  reserve: dusd(487.2),
  treasuryAccrued: dusd(41.1),
  hullSupply: 41_250n * 10n ** 12n,
  balSupply: 12_930n * 10n ** 12n,
  lastSettle: BigInt(Math.floor(Date.now() / 1000) - 12),
  thetaBps: 2387n,
  hullRateBps: 800n,
  balLeveredAprBps: 1940n,
  reserveTargetBps: 200n,
};

function seededEngine(t: number): EngineView {
  const drift = Math.sin(t / 8000) * 0.4;
  const bps = BigInt(Math.round(drift * 100));
  return {
    spotQty: 1_240_5521n * 10n ** 14n,
    spotValue: dusd(24_811.04),
    shortNotional: dusd(24_795),
    netDelta: dusd(16.04 + drift * 50),
    netDeltaBps: bps,
    fundingAccrued: dusd(14.211) + BigInt(Math.floor((t % 1_000_000) * 0.2)),
    lastCrankTs: BigInt(Math.floor(Date.now() / 1000) - 18),
    lastBlock: 8_214_551,
    venueName: "SimVenue",
    simulated: true,
    shortId: 1n,
    keeperActive: true,
    lastCrankBy: "0x8a42aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0042",
  };
}

function sampleWaterfall(negative: boolean): WaterfallEvent[] {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const pos: WaterfallEvent = {
    gross: dusd(31.4021),
    fee: dusd(3.1402),
    toReserve: dusd(1.5701),
    toTreasury: dusd(1.5701),
    hullAccrual: dusd(0.9034),
    toBallast: dusd(27.3585),
    fromBallast: 0n,
    fromReserve: 0n,
    hullTvl: SEEDED_DECK.hullTvl,
    balTvl: SEEDED_DECK.balTvl,
    reserve: SEEDED_DECK.reserve,
    ts: now - 90n,
    txHash: "0xabc01",
    blockNumber: 8_214_540n,
  };
  const neg: WaterfallEvent = {
    gross: dusd(-8.211),
    fee: 0n,
    toReserve: 0n,
    toTreasury: 0n,
    hullAccrual: 0n,
    toBallast: 0n,
    fromBallast: dusd(8.211),
    fromReserve: 0n,
    hullTvl: SEEDED_DECK.hullTvl,
    balTvl: SEEDED_DECK.balTvl - dusd(8.211),
    reserve: SEEDED_DECK.reserve,
    ts: now - 30n,
    txHash: "0xdef02",
    blockNumber: 8_214_548n,
  };
  return negative ? [neg, pos] : [pos];
}

export function MockVesselProvider({
  children,
  demo,
}: {
  children: ReactNode;
  demo?: string | null;
}) {
  const emptyUser = demo === "empty";
  const disconnected = demo === "disconnected";
  const negative = demo === "negative";
  const error = demo === "error";
  const impair = demo === "impair";
  const boarded = demo === "boarded" || demo === "floor" || demo === "states";

  const [now, setNow] = useState(() => Date.now());
  const [dusdBalance, setDusd] = useState(() => (boarded ? dusd(24_500) : 0n));
  const [hullShares, setHullShares] = useState(() => (boarded ? dusd(250) * 10n ** 12n : 0n));
  const [balShares, setBalShares] = useState(() =>
    boarded ? (demo === "floor" ? dusd(80) * 10n ** 12n : dusd(250) * 10n ** 12n) : 0n,
  );
  const [deck, setDeck] = useState<DeckStats>(() => {
    if (demo === "floor") {
      return {
        ...SEEDED_DECK,
        hullTvl: dusd(40_000),
        balTvl: dusd(10_200),
        thetaBps: 2032n,
      };
    }
    return { ...SEEDED_DECK };
  });
  const [waterfall, setWaterfall] = useState<WaterfallEvent[]>(() => sampleWaterfall(negative));
  const [connected, setConnected] = useState(!disconnected);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [impaired] = useState(impair);
  const [lastFaucet, setLastFaucet] = useState(0);
  const [cooldownTick, setCooldown] = useState(0);
  const [hullMeta, setHullMeta] = useState<PositionMeta>(() =>
    boarded
      ? { boardedAt: Date.now() / 1000 - 3600, principal: dusd(250), spark: spark(250) }
      : EMPTY_META,
  );
  const [balMeta, setBalMeta] = useState<PositionMeta>(() =>
    boarded
      ? {
          boardedAt: Date.now() / 1000 - 3600,
          principal: demo === "floor" ? dusd(80) : dusd(250),
          spark: spark(250.4),
        }
      : EMPTY_META,
  );

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!lastFaucet) return;
    const id = window.setInterval(() => {
      const left = Math.ceil((lastFaucet + 3_600_000 - Date.now()) / 1000);
      setCooldown(Math.max(0, left));
    }, 1000);
    return () => window.clearInterval(id);
  }, [lastFaucet]);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((xs) => [...xs, { ...t, id }]);
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const runMockTx = useCallback(
    async (label: string, fn: () => void) => {
      const hash = fakeHash();
      const pending = push({
        kind: "pending",
        text: `${label}…`,
        href: `https://testnet.monadvision.com/tx/${hash}`,
      });
      await new Promise((r) => setTimeout(r, TX_MS));
      fn();
      dismissToast(pending);
      push({
        kind: "success",
        text: `${label} confirmed`,
        href: `https://testnet.monadvision.com/tx/${hash}`,
      });
    },
    [dismissToast, push],
  );

  const faucet = useCallback(async () => {
    const nowMs = Date.now();
    if (lastFaucet && nowMs - lastFaucet < 3_600_000) {
      push({ kind: "error", text: COPY.cooldown(Math.ceil((lastFaucet + 3_600_000 - nowMs) / 1000)) });
      return;
    }
    await runMockTx("Faucet", () => {
      setDusd((b) => b + dusd(100));
      setLastFaucet(Date.now());
    });
  }, [lastFaucet, push, runMockTx]);

  const joinDeck = useCallback(
    async (assets: bigint, kind: DeckKind) => {
      if (assets < MIN_JOIN) {
        push({ kind: "error", text: "Min join is 1 dUSD." });
        throw new Error("BelowMinJoin");
      }
      if (assets > dusdBalance) {
        push({ kind: "error", text: "Amount exceeds balance." });
        throw new Error("balance");
      }
      const newHull = kind === "hull" ? deck.hullTvl + assets : deck.hullTvl;
      const newBal = kind === "ballast" ? deck.balTvl + assets : deck.balTvl;
      if (!thetaWouldHold(newHull, newBal)) {
        push({ kind: "error", text: COPY.floor });
        throw new Error("SubordinationFloor");
      }
      await runMockTx(kind === "hull" ? "Board Hull" : "Board Ballast", () => {
        const shares =
          kind === "hull"
            ? deck.hullSupply === 0n
              ? assets * 1_000_000_000_000n
              : (assets * deck.hullSupply) / deck.hullTvl
            : deck.balSupply === 0n
              ? assets * 1_000_000_000_000n
              : (assets * deck.balSupply) / deck.balTvl;
        setDusd((b) => b - assets);
        if (kind === "hull") {
          setHullShares((s) => s + shares);
          setHullMeta((m) => ({
            boardedAt: m.boardedAt || Date.now() / 1000,
            principal: m.principal + assets,
            spark: spark(Number(m.principal + assets) / 1e6),
          }));
        } else {
          setBalShares((s) => s + shares);
          setBalMeta((m) => ({
            boardedAt: m.boardedAt || Date.now() / 1000,
            principal: m.principal + assets,
            spark: spark(Number(m.principal + assets) / 1e6 + 0.4),
          }));
        }
        const sum = newHull + newBal;
        setDeck((d) => ({
          ...d,
          hullTvl: newHull,
          balTvl: newBal,
          hullSupply: kind === "hull" ? d.hullSupply + shares : d.hullSupply,
          balSupply: kind === "ballast" ? d.balSupply + shares : d.balSupply,
          thetaBps: sum === 0n ? 10_000n : (newBal * 10_000n) / sum,
        }));
      });
    },
    [deck, dusdBalance, push, runMockTx],
  );

  const joinHull = useCallback((assets: bigint) => joinDeck(assets, "hull"), [joinDeck]);
  const joinBallast = useCallback((assets: bigint) => joinDeck(assets, "ballast"), [joinDeck]);

  const exitHull = useCallback(
    async (shares: bigint) => {
      if (shares === 0n || deck.hullSupply === 0n) return;
      const assets = (shares * deck.hullTvl) / deck.hullSupply;
      await runMockTx("Exit Hull", () => {
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
        setHullMeta((m) => ({
          ...m,
          principal: m.principal > assets ? m.principal - assets : 0n,
        }));
      });
    },
    [deck, runMockTx],
  );

  const exitBallast = useCallback(
    async (shares: bigint) => {
      if (shares === 0n || deck.balSupply === 0n) return;
      const assets = (shares * deck.balTvl) / deck.balSupply;
      const newBal = deck.balTvl - assets;
      const newHull = deck.hullTvl;
      const sum = newHull + newBal;
      const newBps = sum === 0n ? 10_000n : (newBal * 10_000n) / sum;
      if (newBps < 2_000n && newBps < deck.thetaBps) {
        push({ kind: "error", text: COPY.floor });
        return;
      }
      await runMockTx("Exit Ballast", () => {
        setBalShares((s) => s - shares);
        setDusd((b) => b + assets);
        setDeck((d) => ({
          ...d,
          balTvl: newBal,
          balSupply: d.balSupply - shares,
          thetaBps: newBps,
        }));
        setBalMeta((m) => ({
          ...m,
          principal: m.principal > assets ? m.principal - assets : 0n,
        }));
      });
    },
    [deck, push, runMockTx],
  );

  const crank = useCallback(async () => {
    if (impaired) {
      push({ kind: "error", text: COPY.impair });
      return;
    }
    const hash = fakeHash();
    const pending = push({
      kind: "pending",
      text: "Crank…",
      href: `https://testnet.monadvision.com/tx/${hash}`,
    });
    await new Promise((r) => setTimeout(r, TX_MS));
    const useNeg = negative;
    const G = useNeg ? dusd(-8.211) : dusd(31.4021);
    const fee = useNeg ? 0n : dusd(3.1402);
    const toReserve = useNeg ? 0n : dusd(1.5701);
    const toTreasury = useNeg ? 0n : dusd(1.5701);
    const hullAccrual = useNeg ? 0n : dusd(0.9034);
    const toBallast = useNeg ? 0n : dusd(27.3585);
    const fromBallast = useNeg ? dusd(8.211) : 0n;
    setDeck((d) => {
      const hullTvl = d.hullTvl + hullAccrual;
      const balTvl = d.balTvl + toBallast - fromBallast;
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
      fromBallast,
      fromReserve: 0n,
      hullTvl: deck.hullTvl + hullAccrual,
      balTvl: deck.balTvl + toBallast - fromBallast,
      reserve: deck.reserve + toReserve,
      ts: BigInt(Math.floor(Date.now() / 1000)),
      txHash: hash,
      blockNumber: 8_214_560n,
    };
    setWaterfall((w) => [ev, ...w].slice(0, 24));
    dismissToast(pending);
    push({
      kind: "success",
      text: "Cranked — waterfall settled",
      href: `https://testnet.monadvision.com/tx/${hash}`,
    });
  }, [deck, dismissToast, impaired, negative, push]);

  const engine = useMemo(() => {
    const e = seededEngine(now);
    if (error) return e;
    return e;
  }, [error, now]);

  const value = useMemo<VesselDataProvider>(
    () => ({
      dusdBalance: emptyUser ? dusdBalance : dusdBalance,
      hullShares: emptyUser ? 0n : hullShares,
      balShares: emptyUser ? 0n : balShares,
      deck,
      engine: { ...engine, lastBlock: engine.lastBlock + Math.floor(now / 4000) % 20 },
      waterfall,
      loading: false,
      connected,
      address: connected ? MOCK_ADDR : undefined,
      chainId: 10143,
      wrongNetwork: demo === "wrongnet",
      reconnecting: error,
      paused: demo === "paused",
      impaired,
      faucetCooldownSec: cooldownTick,
      hullMeta: emptyUser ? EMPTY_META : hullMeta,
      balMeta: emptyUser ? EMPTY_META : balMeta,
      toasts,
      faucet,
      deposit: (amount, kind) => joinDeck(amount, kind),
      withdraw: (shares, kind) => (kind === "hull" ? exitHull(shares) : exitBallast(shares)),
      joinHull,
      joinBallast,
      exitHull,
      exitBallast,
      crank,
      deployLiquidity: () => runMockTx("Deploy hedge", () => undefined),
      connect: async () => setConnected(true),
      disconnect: async () => setConnected(false),
      switchNetwork: async () => {},
      dismissToast,
    }),
    [
      balMeta,
      balShares,
      connected,
      cooldownTick,
      crank,
      deck,
      demo,
      dusdBalance,
      emptyUser,
      engine,
      error,
      exitBallast,
      exitHull,
      faucet,
      hullMeta,
      hullShares,
      impaired,
      joinBallast,
      joinDeck,
      joinHull,
      now,
      runMockTx,
      toasts,
      waterfall,
      dismissToast,
    ],
  );

  return <VesselContext.Provider value={value}>{children}</VesselContext.Provider>;
}
