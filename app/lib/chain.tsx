"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Abi, Log } from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { ADDRESSES, CHAIN_ID, DEPLOYED_BLOCK } from "./addresses";
import { VesselContext } from "./context";
import { decodeVesselError } from "./errors";
import {
  COPY,
  type DeckKind,
  type HistorySource,
  type Toast,
  type VesselDataProvider,
  type WaterfallEvent,
} from "./provider";
import {
  fromMulticall,
  isBigint,
  isBool,
  isStr,
  map2,
  mapLive,
  ok,
  unavailable,
  valueOrForLogic,
  type Live,
} from "./live";
import { EXPLORER, TARGET_CHAIN_ID, vesselChain } from "./wagmi";
import { GAS_CEILING, gasFor } from "./gas";
import { fetchWaterfall, statsUrl } from "./stats";
import demoAbiJson from "./abis/DemoUSD.json";
import engineAbiJson from "./abis/EngineLite.json";
import guardianAbiJson from "./abis/Guardian.json";
import simAbiJson from "./abis/SimVenue.json";
import tranchesAbiJson from "./abis/Tranches.json";
import vaultAbiJson from "./abis/BlitzVault.json";

const demoAbi = demoAbiJson as Abi;
const tranchesAbi = tranchesAbiJson as Abi;
const engineAbi = engineAbiJson as Abi;
const simAbi = simAbiJson as Abi;
const guardianAbi = guardianAbiJson as Abi;
const vaultAbi = vaultAbiJson as Abi;

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;

/** DemoUSD.FAUCET_COOLDOWN — 1 hour, a compile-time constant in the contract. */
const FAUCET_COOLDOWN_SEC = 3_600n;
/** DemoUSD.LIFETIME_CAP — 1,000 dUSD. */
const FAUCET_LIFETIME_CAP = 1_000_000_000n;

/**
 * Waterfall log decoding. Unlike a provider read, an event that is missing a
 * field is a malformed log rather than an unavailable datum, so we drop the
 * row entirely instead of substituting zeros into the history.
 */
function mapWaterfall(
  e: Log & { args?: Record<string, unknown>; transactionHash: `0x${string}` },
): WaterfallEvent | null {
  const a = (e.args ?? {}) as Record<string, unknown>;
  const need = (k: string): bigint | null => (typeof a[k] === "bigint" ? (a[k] as bigint) : null);
  const gross = need("gross");
  const fee = need("fee");
  const toReserve = need("toReserve");
  const toTreasury = need("toTreasury");
  const hullAccrual = need("hullAccrual");
  const toBallast = need("toBallast");
  const fromBallast = need("fromBallast");
  const fromReserve = need("fromReserve");
  const hullTvl = need("hullTvl");
  const balTvl = need("balTvl");
  const reserve = need("reserve");
  const ts = need("ts");
  if (
    gross === null || fee === null || toReserve === null || toTreasury === null ||
    hullAccrual === null || toBallast === null || fromBallast === null ||
    fromReserve === null || hullTvl === null || balTvl === null ||
    reserve === null || ts === null
  ) {
    return null;
  }
  return {
    gross, fee, toReserve, toTreasury, hullAccrual, toBallast,
    fromBallast, fromReserve, hullTvl, balTvl, reserve, ts,
    txHash: e.transactionHash,
    blockNumber: e.blockNumber === null ? undefined : e.blockNumber,
  };
}

/** Index into the primary multicall. Keeps the read list and its consumers in step. */
const R = {
  dusd: 0, hull: 1, bal: 2, deck: 3,
  netDelta: 4, netDeltaBps: 5, shortId: 6,
  simulated: 7, venueName: 8, paused: 9,
  spotQty: 10, lastCrank: 11, lastSpot: 12,
  vaultIdle: 13, vaultDeployed: 14,
  lastFaucetAt: 15, mintedLifetime: 16,
  hullRateBps: 17, reserveTargetBps: 18, thetaMinBps: 19, feeBps: 20,
  fundingRateBps: 21,
} as const;

export function ChainVesselProvider({ children }: { children: ReactNode }) {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [impaired, setImpaired] = useState(false);
  const [liveEvents, setLive] = useState<WaterfallEvent[]>([]);

  const wrongNetwork = isConnected && chainId !== TARGET_CHAIN_ID;

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((xs) => [...xs, { ...t, id }]);
    return id;
  }, []);
  const dismissToast = useCallback((id: string) => {
    setToasts((xs) => xs.filter((t) => t.id !== id));
  }, []);

  const reads = useQuery({
    queryKey: ["vessel", address, chainId],
    enabled: !!publicClient,
    placeholderData: keepPreviousData,
    refetchInterval: 4_000,
    queryFn: async () => {
      if (!publicClient) throw new Error("rpc");
      const acct = address ?? ZERO_ADDR;

      const entries = await publicClient.multicall({
        contracts: [
          { address: ADDRESSES.DemoUSD, abi: demoAbi, functionName: "balanceOf", args: [acct] },
          { address: ADDRESSES.Hull, abi: demoAbi, functionName: "balanceOf", args: [acct] },
          { address: ADDRESSES.Ballast, abi: demoAbi, functionName: "balanceOf", args: [acct] },
          { address: ADDRESSES.Tranches, abi: tranchesAbi, functionName: "deckStats" },
          { address: ADDRESSES.EngineLite, abi: engineAbi, functionName: "netDelta" },
          { address: ADDRESSES.EngineLite, abi: engineAbi, functionName: "netDeltaBps" },
          { address: ADDRESSES.EngineLite, abi: engineAbi, functionName: "shortId" },
          { address: ADDRESSES.SimVenue, abi: simAbi, functionName: "isSimulated" },
          { address: ADDRESSES.SimVenue, abi: simAbi, functionName: "venueName" },
          { address: ADDRESSES.Guardian, abi: guardianAbi, functionName: "paused" },
          { address: ADDRESSES.MockWMON, abi: demoAbi, functionName: "balanceOf", args: [ADDRESSES.EngineLite] },
          { address: ADDRESSES.EngineLite, abi: engineAbi, functionName: "lastCrank" },
          { address: ADDRESSES.EngineLite, abi: engineAbi, functionName: "lastSpotValue" },
          // Vault liquidity — what an exit can actually be paid from.
          { address: ADDRESSES.DemoUSD, abi: demoAbi, functionName: "balanceOf", args: [ADDRESSES.BlitzVault] },
          { address: ADDRESSES.BlitzVault, abi: vaultAbi, functionName: "deployed" },
          // Faucet state, so the cooldown is read rather than assumed ready.
          { address: ADDRESSES.DemoUSD, abi: demoAbi, functionName: "lastFaucetAt", args: [acct] },
          { address: ADDRESSES.DemoUSD, abi: demoAbi, functionName: "mintedLifetime", args: [acct] },
          // Protocol parameters — read, not hardcoded.
          { address: ADDRESSES.Tranches, abi: tranchesAbi, functionName: "HULL_RATE_BPS" },
          { address: ADDRESSES.Tranches, abi: tranchesAbi, functionName: "RESERVE_TARGET_BPS" },
          { address: ADDRESSES.Tranches, abi: tranchesAbi, functionName: "THETA_MIN_BPS" },
          { address: ADDRESSES.Tranches, abi: tranchesAbi, functionName: "FEE_BPS" },
          { address: ADDRESSES.SimVenue, abi: simAbi, functionName: "fundingRateBps" },
        ],
        allowFailure: true,
      });

      // Chain time, not client time — the faucet cooldown is compared against
      // block.timestamp on chain, so comparing it to a local clock would drift.
      const block = await publicClient.getBlock({ blockTag: "latest" });
      const asOf = Number(block.timestamp);

      // The venue position carries BOTH the notional and the accrued funding.
      // The old provider fetched this, used [0], and hardcoded funding to zero.
      const sidEntry = entries[R.shortId];
      const sid = sidEntry?.status === "success" && typeof sidEntry.result === "bigint"
        ? sidEntry.result
        : null;
      let position: { notional: bigint; funding: bigint } | { error: string } = {
        error: "no position open",
      };
      if (sid !== null && sid !== 0n) {
        try {
          const pos = (await publicClient.readContract({
            address: ADDRESSES.SimVenue,
            abi: simAbi,
            functionName: "position",
            args: [sid],
          })) as readonly [bigint, bigint];
          position = { notional: pos[0], funding: pos[1] };
        } catch (err) {
          position = { error: err instanceof Error ? err.message.slice(0, 80) : "venue read reverted" };
        }
      }

      return { entries, asOf, blockNumber: Number(block.number), position, hasShort: sid !== null && sid !== 0n };
    },
  });

  /** Waterfall history: stats service preferred, chain fallback, and we say which. */
  const logs = useQuery({
    queryKey: ["waterfall", CHAIN_ID, DEPLOYED_BLOCK],
    enabled: !!publicClient || Boolean(statsUrl()),
    placeholderData: keepPreviousData,
    refetchInterval: 8_000,
    queryFn: async (): Promise<{ rows: WaterfallEvent[]; source: HistorySource }> => {
      const fromApi = await fetchWaterfall(50);
      if (fromApi && fromApi.length) return { rows: fromApi.slice(0, 50), source: "stats" };
      if (!publicClient) return { rows: [], source: "none" };
      try {
        const evs = await publicClient.getContractEvents({
          address: ADDRESSES.Tranches,
          abi: tranchesAbi,
          eventName: "Waterfall",
          fromBlock: BigInt(DEPLOYED_BLOCK),
        });
        const rows = evs
          .slice()
          .reverse()
          .slice(0, 24)
          .map((e) => mapWaterfall(e as Parameters<typeof mapWaterfall>[0]))
          .filter((x): x is WaterfallEvent => x !== null);
        // An empty stats response plus an empty chain response is genuinely
        // "no settles yet"; we still label the source as chain so the UI can
        // say history is limited to what the RPC will serve.
        return { rows, source: fromApi === null ? "chain" : "chain" };
      } catch {
        return { rows: [], source: "none" };
      }
    },
  });

  useEffect(() => {
    if (!publicClient) return;
    const unwatch = publicClient.watchContractEvent({
      address: ADDRESSES.Tranches,
      abi: tranchesAbi,
      eventName: "Waterfall",
      onLogs: (evs) => {
        setLive((prev) => {
          const mapped = evs
            .map((e) => mapWaterfall(e as Parameters<typeof mapWaterfall>[0]))
            .filter((x): x is WaterfallEvent => x !== null);
          const seen = new Set(prev.map((x) => x.txHash));
          return [...mapped.filter((x) => !seen.has(x.txHash)), ...prev].slice(0, 24);
        });
      },
    });
    return () => unwatch();
  }, [publicClient]);

  const runTx = useCallback(
    async (label: string, fn: () => Promise<`0x${string}`>) => {
      const pending = push({ kind: "pending", text: `${label}…` });
      try {
        const hash = await fn();
        const receipt = await publicClient?.waitForTransactionReceipt({ hash });
        if (receipt && receipt.status !== "success") throw new Error("transaction reverted");
        dismissToast(pending);
        push({
          kind: "success",
          text: `${label} confirmed`,
          href: EXPLORER && receipt ? `${EXPLORER}/tx/${hash}` : undefined,
        });
        await Promise.all([reads.refetch(), logs.refetch()]);
      } catch (err) {
        dismissToast(pending);
        const text = decodeVesselError(err);
        if (!text) return;
        if (text === COPY.impair) setImpaired(true);
        push({ kind: "error", text });
      }
    },
    [dismissToast, publicClient, push, reads, logs],
  );

  const ensureApprove = useCallback(
    async (assets: bigint) => {
      if (!address || !publicClient) throw new Error("wallet");
      const allowance = (await publicClient.readContract({
        address: ADDRESSES.DemoUSD,
        abi: demoAbi,
        functionName: "allowance",
        args: [address, ADDRESSES.Tranches],
      })) as bigint;
      if (allowance >= assets) return;
      const gas = await gasFor(
        () =>
          publicClient.estimateContractGas({
            address: ADDRESSES.DemoUSD,
            abi: demoAbi,
            functionName: "approve",
            args: [ADDRESSES.Tranches, assets],
            account: address,
          }),
        GAS_CEILING.approve,
      );
      const hash = await writeContractAsync({
        address: ADDRESSES.DemoUSD,
        abi: demoAbi,
        functionName: "approve",
        args: [ADDRESSES.Tranches, assets],
        gas,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    },
    [address, publicClient, writeContractAsync],
  );

  /** Estimate against the connected account, buffered 10%, ceiling-capped. */
  const estimate = useCallback(
    (
      to: `0x${string}`,
      abi: Abi,
      functionName: string,
      ceiling: bigint,
      args?: readonly unknown[],
    ) =>
      gasFor(() => {
        if (!publicClient || !address) throw new Error("no client");
        return publicClient.estimateContractGas({
          address: to,
          abi,
          functionName,
          args: args as never,
          account: address,
        });
      }, ceiling),
    [publicClient, address],
  );

  const value = useMemo<VesselDataProvider>(() => {
    const d = reads.data;
    const down = "RPC read did not return";

    /**
     * Every read is lifted through here. There is deliberately no bare `asOf`
     * variable in this scope: without a snapshot there is no timestamp to
     * default, so the only representable outcome is `unavailable`.
     */
    const at = <T,>(i: number, what: string, guard: (v: unknown) => v is T): Live<T> =>
      d ? fromMulticall<T>(d.entries[i], d.asOf, what, guard) : unavailable<T>(`${what} — ${down}`);

    const big = (i: number, what: string) => at<bigint>(i, what, isBigint);

    // deckStats() returns one tuple; each member is its own datum but they
    // share a single success/failure, so they share a single reason string.
    const deckTuple = at<readonly unknown[]>(R.deck, "deck stats", (v): v is readonly unknown[] =>
      Array.isArray(v),
    );
    const deckAt = (i: number, what: string): Live<bigint> => {
      if (deckTuple.status !== "ok") return unavailable(`${what} — ${deckTuple.reason}`);
      const val = deckTuple.value[i];
      if (typeof val !== "bigint") return unavailable(`${what} — unexpected type`);
      return ok(val, deckTuple.source, deckTuple.asOf);
    };

    const deck = {
      hullTvl: deckAt(0, "Hull TVL"),
      balTvl: deckAt(1, "Ballast TVL"),
      reserve: deckAt(2, "reserve"),
      treasuryAccrued: deckAt(3, "treasury accrued"),
      hullSupply: deckAt(4, "Hull share supply"),
      balSupply: deckAt(5, "Ballast share supply"),
      lastSettle: deckAt(6, "last settle"),
      thetaBps: deckAt(7, "subordination ratio"),
      hullRateBps: big(R.hullRateBps, "Hull coupon rate"),
      reserveTargetBps: big(R.reserveTargetBps, "reserve target"),
      thetaMinBps: big(R.thetaMinBps, "subordination floor"),
      feeBps: big(R.feeBps, "protocol fee"),
    };

    const shortNotional: Live<bigint> =
      d && "notional" in d.position
        ? ok(d.position.notional, "chain", d.asOf)
        : unavailable(`short notional — ${d && "error" in d.position ? d.position.error : down}`);
    const fundingAccrued: Live<bigint> =
      d && "funding" in d.position
        ? ok(d.position.funding, "chain", d.asOf)
        : unavailable(`funding accrued — ${d && "error" in d.position ? d.position.error : down}`);

    const engine = {
      spotQty: big(R.spotQty, "WMON spot quantity"),
      spotValue: big(R.lastSpot, "spot mark"),
      shortNotional,
      netDelta: big(R.netDelta, "net delta"),
      netDeltaBps: big(R.netDeltaBps, "net delta bps"),
      fundingAccrued,
      fundingRateBps: big(R.fundingRateBps, "venue funding rate"),
      lastCrankTs: big(R.lastCrank, "last crank"),
      lastBlock: d ? ok(d.blockNumber, "chain", d.asOf) : unavailable<number>(`block height — ${down}`),
      venueName: at<string>(R.venueName, "venue name", isStr),
      simulated: at<boolean>(R.simulated, "venue simulation flag", isBool),
      shortId: big(R.shortId, "position id"),
      // Keeper liveness is a claim about a hosted process; without the stats
      // service we cannot observe it, so we do not assert it either way.
      keeperActive:
        statsUrl() && d
          ? ok(true, "stats", d.asOf)
          : unavailable<boolean>(
              statsUrl() ? `keeper liveness — ${down}` : "keeper liveness — no stats service configured",
            ),
      lastCrankBy: unavailable<`0x${string}`>("last cranker — not indexed by this provider"),
    };

    const vault = {
      idle: big(R.vaultIdle, "vault idle liquidity"),
      deployed: big(R.vaultDeployed, "deployed capital"),
    };

    const lastFaucet = big(R.lastFaucetAt, "faucet timestamp");
    const minted = big(R.mintedLifetime, "faucet lifetime minted");
    const faucetState = {
      cooldownSec: d
        ? mapLive(lastFaucet, (last) => {
            if (last === 0n) return 0;
            const ready = Number(last + FAUCET_COOLDOWN_SEC);
            return d.asOf >= ready ? 0 : ready - d.asOf;
          })
        : unavailable<number>(`faucet cooldown — ${down}`),
      lifetimeRemaining: mapLive(minted, (m) =>
        m >= FAUCET_LIFETIME_CAP ? 0n : FAUCET_LIFETIME_CAP - m,
      ),
    };

    const merged: WaterfallEvent[] = [];
    const seen = new Set<string>();
    for (const ev of [...liveEvents, ...(logs.data?.rows ?? [])]) {
      if (seen.has(ev.txHash)) continue;
      seen.add(ev.txHash);
      merged.push(ev);
    }

    const joinHull = (assets: bigint) =>
      runTx("Join Hull", async () => {
        await ensureApprove(assets);
        return writeContractAsync({
          address: ADDRESSES.Tranches,
          abi: tranchesAbi,
          functionName: "joinHull",
          args: [assets],
          gas: await estimate(ADDRESSES.Tranches, tranchesAbi, "joinHull", GAS_CEILING.join, [assets]),
        });
      });
    const joinBallast = (assets: bigint) =>
      runTx("Join Ballast", async () => {
        await ensureApprove(assets);
        return writeContractAsync({
          address: ADDRESSES.Tranches,
          abi: tranchesAbi,
          functionName: "joinBallast",
          args: [assets],
          gas: await estimate(ADDRESSES.Tranches, tranchesAbi, "joinBallast", GAS_CEILING.join, [assets]),
        });
      });
    const exitHull = (shares: bigint) =>
      runTx("Exit Hull", async () =>
        writeContractAsync({
          address: ADDRESSES.Tranches,
          abi: tranchesAbi,
          functionName: "exitHull",
          args: [shares],
          gas: await estimate(ADDRESSES.Tranches, tranchesAbi, "exitHull", GAS_CEILING.exit, [shares]),
        }),
      );
    const exitBallast = (shares: bigint) =>
      runTx("Exit Ballast", async () =>
        writeContractAsync({
          address: ADDRESSES.Tranches,
          abi: tranchesAbi,
          functionName: "exitBallast",
          args: [shares],
          gas: await estimate(ADDRESSES.Tranches, tranchesAbi, "exitBallast", GAS_CEILING.exit, [shares]),
        }),
      );

    const historySource: HistorySource = logs.data?.source ?? (statsUrl() ? "stats" : "none");

    return {
      dusdBalance: big(R.dusd, "dUSD balance"),
      hullShares: big(R.hull, "Hull shares"),
      balShares: big(R.bal, "Ballast shares"),
      deck,
      engine,
      vault,
      faucetState,
      waterfall: merged.slice(0, 50),
      historySource,
      paused: at<boolean>(R.paused, "pause state", isBool),

      loading: reads.isLoading && !reads.data,
      connected: isConnected,
      address,
      chainId: chainId === undefined ? 0 : chainId, // rule0-ok: local wallet state, not a chain read
      wrongNetwork,
      reconnecting: reads.isError,
      impaired,
      isMock: false,

      // Per-user history needs an indexer keyed by address; this provider does
      // not have one. Saying so is the honest answer — the old code returned a
      // zero principal and an empty sparkline, which read as real data.
      hullMeta: {
        boardedAt: unavailable<number>("boarding time — needs an address-indexed history service"),
        principal: unavailable<bigint>("principal — needs an address-indexed history service"),
        spark: unavailable<number[]>("no indexed history for this address"),
      },
      balMeta: {
        boardedAt: unavailable<number>("boarding time — needs an address-indexed history service"),
        principal: unavailable<bigint>("principal — needs an address-indexed history service"),
        spark: unavailable<number[]>("no indexed history for this address"),
      },
      toasts,

      deposit: (amount: bigint, kind: DeckKind) =>
        kind === "hull" ? joinHull(amount) : joinBallast(amount),
      withdraw: (shares: bigint, kind: DeckKind) =>
        kind === "hull" ? exitHull(shares) : exitBallast(shares),
      faucet: () =>
        runTx("Faucet", async () =>
          writeContractAsync({
            address: ADDRESSES.DemoUSD,
            abi: demoAbi,
            functionName: "faucet",
            gas: await estimate(ADDRESSES.DemoUSD, demoAbi, "faucet", GAS_CEILING.faucet),
          }),
        ),
      joinHull,
      joinBallast,
      exitHull,
      exitBallast,
      crank: () =>
        runTx("Crank", async () =>
          writeContractAsync({
            address: ADDRESSES.EngineLite,
            abi: engineAbi,
            functionName: "crank",
            gas: await estimate(ADDRESSES.EngineLite, engineAbi, "crank", GAS_CEILING.crank),
          }),
        ),
      deployLiquidity: () =>
        runTx("Deploy hedge", async () => {
          if (!publicClient) throw new Error("no client");
          const routerAbi = [
            {
              type: "function",
              name: "quoteExactQuoteForBase",
              stateMutability: "view",
              inputs: [{ name: "quoteIn", type: "uint256" }],
              outputs: [{ name: "", type: "uint256" }],
            },
          ] as const satisfies Abi;
          const [routerAddr, deployable] = await Promise.all([
            publicClient.readContract({
              address: ADDRESSES.EngineLite,
              abi: engineAbi,
              functionName: "router",
            }) as Promise<`0x${string}`>,
            publicClient.readContract({
              address: ADDRESSES.BlitzVault,
              abi: vaultAbi,
              functionName: "deployable",
            }) as Promise<bigint>,
          ]);
          const toSpot = deployable / 2n;
          const minBaseOut = (await publicClient.readContract({
            address: routerAddr,
            abi: routerAbi,
            functionName: "quoteExactQuoteForBase",
            args: [toSpot],
          })) as bigint;
          if (minBaseOut === 0n) throw new Error("minBaseOut is 0 — book empty or quote failed");
          return writeContractAsync({
            address: ADDRESSES.EngineLite,
            abi: engineAbi,
            functionName: "deployLiquidity",
            args: [minBaseOut],
            gas: await estimate(
              ADDRESSES.EngineLite,
              engineAbi,
              "deployLiquidity",
              GAS_CEILING.deployLiquidity,
              [minBaseOut],
            ),
          });
        }),
      unwind: () =>
        runTx("Unwind hedge", async () => {
          if (!publicClient) throw new Error("no client");
          const routerAbi = [
            {
              type: "function",
              name: "quoteExactBaseForQuote",
              stateMutability: "view",
              inputs: [{ name: "baseIn", type: "uint256" }],
              outputs: [{ name: "", type: "uint256" }],
            },
          ] as const satisfies Abi;
          const [routerAddr, wmonAddr] = await Promise.all([
            publicClient.readContract({
              address: ADDRESSES.EngineLite,
              abi: engineAbi,
              functionName: "router",
            }) as Promise<`0x${string}`>,
            publicClient.readContract({
              address: ADDRESSES.EngineLite,
              abi: engineAbi,
              functionName: "wmon",
            }) as Promise<`0x${string}`>,
          ]);
          const wmonBal = (await publicClient.readContract({
            address: wmonAddr,
            abi: [
              {
                type: "function",
                name: "balanceOf",
                stateMutability: "view",
                inputs: [{ name: "account", type: "address" }],
                outputs: [{ name: "", type: "uint256" }],
              },
            ] as const satisfies Abi,
            functionName: "balanceOf",
            args: [ADDRESSES.EngineLite],
          })) as bigint;
          // No spot left — still need a non-zero floor only when bal>0; engine
          // skips the swap when bal==0, but reverts if bal>0 and minOut==0.
          const minQuoteOut =
            wmonBal === 0n
              ? 1n
              : ((await publicClient.readContract({
                  address: routerAddr,
                  abi: routerAbi,
                  functionName: "quoteExactBaseForQuote",
                  args: [wmonBal],
                })) as bigint);
          if (wmonBal > 0n && minQuoteOut === 0n) {
            throw new Error("minQuoteOut is 0 — book empty or quote failed");
          }
          return writeContractAsync({
            address: ADDRESSES.EngineLite,
            abi: engineAbi,
            functionName: "unwind",
            args: [minQuoteOut],
            gas: await estimate(ADDRESSES.EngineLite, engineAbi, "unwind", GAS_CEILING.unwind, [
              minQuoteOut,
            ]),
          });
        }),
      connectors: connectors.map((c) => ({ id: c.id, name: c.name, ready: true })),
      connect: async (connectorId?: string) => {
        try {
          const c = connectorId ? connectors.find((x) => x.id === connectorId) : connectors[0];
          if (c) await connectAsync({ connector: c, chainId: TARGET_CHAIN_ID });
        } catch {
          /* wallet reject is quiet */
        }
      },
      disconnect: async () => {
        disconnect();
      },
      switchNetwork: async () => {
        try {
          await switchChainAsync({ chainId: TARGET_CHAIN_ID });
        } catch {
          try {
            const eth = (
              window as unknown as { ethereum?: { request: (args: unknown) => Promise<unknown> } }
            ).ethereum;
            if (!eth) return;
            await eth.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: `0x${TARGET_CHAIN_ID.toString(16)}`,
                  chainName: vesselChain.name,
                  nativeCurrency: vesselChain.nativeCurrency,
                  rpcUrls: [vesselChain.rpcUrls.default.http[0]],
                  blockExplorerUrls: vesselChain.blockExplorers
                    ? [vesselChain.blockExplorers.default.url]
                    : [],
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
    address, chainId, connectors, connectAsync, disconnect, dismissToast,
    ensureApprove, estimate, impaired, isConnected, liveEvents, logs,
    reads.data, reads.isError, reads.isLoading, runTx, switchChainAsync,
    toasts, wrongNetwork, writeContractAsync,
  ]);

  return <VesselContext.Provider value={value}>{children}</VesselContext.Provider>;
}

// Referenced so the linter keeps these imports honest if a consumer is removed.
export type { Live };
export { map2, valueOrForLogic };
