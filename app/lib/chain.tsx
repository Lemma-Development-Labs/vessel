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
  EMPTY_DECK,
  EMPTY_META,
  type DeckKind,
  type Toast,
  type VesselDataProvider,
  type WaterfallEvent,
} from "./provider";
import { EXPLORER, TARGET_CHAIN_ID, vesselChain } from "./wagmi";
import { GAS } from "./gas";
import { fetchWaterfall, statsUrl } from "./stats";
import demoAbiJson from "./abis/DemoUSD.json";
import engineAbiJson from "./abis/EngineLite.json";
import guardianAbiJson from "./abis/Guardian.json";
import simAbiJson from "./abis/SimVenue.json";
import tranchesAbiJson from "./abis/Tranches.json";

const demoAbi = demoAbiJson as Abi;
const tranchesAbi = tranchesAbiJson as Abi;
const engineAbi = engineAbiJson as Abi;
const simAbi = simAbiJson as Abi;
const guardianAbi = guardianAbiJson as Abi;

function mapWaterfall(e: Log & { args?: Record<string, unknown>; transactionHash: `0x${string}` }): WaterfallEvent {
  const a = (e.args ?? {}) as Record<string, bigint>;
  return {
    gross: (a.gross as bigint) ?? 0n,
    fee: a.fee ?? 0n,
    toReserve: a.toReserve ?? 0n,
    toTreasury: a.toTreasury ?? 0n,
    hullAccrual: a.hullAccrual ?? 0n,
    toBallast: a.toBallast ?? 0n,
    fromBallast: a.fromBallast ?? 0n,
    fromReserve: a.fromReserve ?? 0n,
    hullTvl: a.hullTvl ?? 0n,
    balTvl: a.balTvl ?? 0n,
    reserve: a.reserve ?? 0n,
    ts: a.ts ?? 0n,
    txHash: e.transactionHash,
  };
}

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
      const acct = address ?? "0x0000000000000000000000000000000000000000";
      const [
        dusd,
        hull,
        bal,
        deck,
        netDelta,
        netDeltaBps,
        shortId,
        simulated,
        venueName,
        paused,
      ] = await publicClient.multicall({
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
        ],
        allowFailure: true,
      });
      const sid = (shortId.result as bigint) ?? 0n;
      const extra = await publicClient.multicall({
        contracts: [
          {
            address: ADDRESSES.MockWMON,
            abi: demoAbi,
            functionName: "balanceOf",
            args: [ADDRESSES.EngineLite],
          },
          { address: ADDRESSES.EngineLite, abi: engineAbi, functionName: "lastCrank" },
          { address: ADDRESSES.EngineLite, abi: engineAbi, functionName: "lastSpotValue" },
        ],
        allowFailure: true,
      });
      let shortNotional = 0n;
      if (sid !== 0n) {
        try {
          const pos = (await publicClient.readContract({
            address: ADDRESSES.SimVenue,
            abi: simAbi,
            functionName: "position",
            args: [sid],
          })) as readonly [bigint, bigint];
          shortNotional = pos[0];
        } catch {
          shortNotional = 0n;
        }
      }
      const lastBlock = Number(await publicClient.getBlockNumber());
      return {
        dusd,
        hull,
        bal,
        deck,
        netDelta,
        netDeltaBps,
        shortId,
        simulated,
        venueName,
        paused,
        spotQty: extra[0],
        lastCrank: extra[1],
        lastSpot: extra[2],
        shortNotional,
        lastBlock,
      };
    },
  });

  const logs = useQuery({
    queryKey: ["waterfall", CHAIN_ID, DEPLOYED_BLOCK],
    enabled: !!publicClient || Boolean(statsUrl()),
    placeholderData: keepPreviousData,
    refetchInterval: 8_000,
    queryFn: async () => {
      const fromApi = await fetchWaterfall(50);
      if (fromApi && fromApi.length) return fromApi.slice(0, 50);
      if (!publicClient) return [] as WaterfallEvent[];
      const evs = await publicClient.getContractEvents({
        address: ADDRESSES.Tranches,
        abi: tranchesAbi,
        eventName: "Waterfall",
        fromBlock: BigInt(DEPLOYED_BLOCK),
      });
      return evs
        .slice()
        .reverse()
        .slice(0, 24)
        .map((e) => mapWaterfall(e as Parameters<typeof mapWaterfall>[0]));
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
          const mapped = evs.map((e) => mapWaterfall(e as Parameters<typeof mapWaterfall>[0]));
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
        if (receipt && receipt.status !== "success") {
          throw new Error("transaction reverted");
        }
        dismissToast(pending);
        push({
          kind: "success",
          text: `${label} confirmed`,
          href: EXPLORER && receipt ? `${EXPLORER}/tx/${hash}` : undefined,
        });
      } catch (err) {
        dismissToast(pending);
        const text = decodeVesselError(err);
        if (!text) return;
        if (text === COPY.impair) setImpaired(true);
        push({ kind: "error", text });
      }
    },
    [dismissToast, publicClient, push],
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
      const hash = await writeContractAsync({
        address: ADDRESSES.DemoUSD,
        abi: demoAbi,
        functionName: "approve",
        args: [ADDRESSES.Tranches, assets],
        gas: GAS.approve,
      });
      await publicClient.waitForTransactionReceipt({ hash });
    },
    [address, publicClient, writeContractAsync],
  );

  const value = useMemo<VesselDataProvider>(() => {
    const deckRaw = reads.data?.deck?.result as unknown[] | undefined;
    const deck = deckRaw
      ? {
          hullTvl: (deckRaw[0] as bigint) ?? 0n,
          balTvl: (deckRaw[1] as bigint) ?? 0n,
          reserve: (deckRaw[2] as bigint) ?? 0n,
          treasuryAccrued: (deckRaw[3] as bigint) ?? 0n,
          hullSupply: (deckRaw[4] as bigint) ?? 0n,
          balSupply: (deckRaw[5] as bigint) ?? 0n,
          lastSettle: (deckRaw[6] as bigint) ?? 0n,
          thetaBps: (deckRaw[7] as bigint) ?? 0n,
          hullRateBps: 800n,
          balLeveredAprBps: 1940n,
          reserveTargetBps: 200n,
        }
      : EMPTY_DECK;

    const merged: WaterfallEvent[] = [];
    const seen = new Set<string>();
    for (const ev of [...liveEvents, ...(logs.data ?? [])]) {
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
          gas: GAS.join,
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
          gas: GAS.join,
        });
      });
    const exitHull = (shares: bigint) =>
      runTx("Exit Hull", () =>
        writeContractAsync({
          address: ADDRESSES.Tranches,
          abi: tranchesAbi,
          functionName: "exitHull",
          args: [shares],
          gas: GAS.exit,
        }),
      );
    const exitBallast = (shares: bigint) =>
      runTx("Exit Ballast", () =>
        writeContractAsync({
          address: ADDRESSES.Tranches,
          abi: tranchesAbi,
          functionName: "exitBallast",
          args: [shares],
          gas: GAS.exit,
        }),
      );

    return {
      dusdBalance: (reads.data?.dusd?.result as bigint) ?? 0n,
      hullShares: (reads.data?.hull?.result as bigint) ?? 0n,
      balShares: (reads.data?.bal?.result as bigint) ?? 0n,
      deck,
      engine: {
        spotQty: (reads.data?.spotQty?.result as bigint) ?? 0n,
        spotValue: (reads.data?.lastSpot?.result as bigint) ?? 0n,
        shortNotional: reads.data?.shortNotional ?? 0n,
        netDelta: (reads.data?.netDelta?.result as bigint) ?? 0n,
        netDeltaBps: (reads.data?.netDeltaBps?.result as bigint) ?? 0n,
        fundingAccrued: 0n,
        lastCrankTs: (reads.data?.lastCrank?.result as bigint) ?? 0n,
        lastBlock: reads.data?.lastBlock ?? 0,
        venueName: String(reads.data?.venueName?.result ?? "SimVenue"),
        simulated: Boolean(reads.data?.simulated?.result ?? true),
        shortId: (reads.data?.shortId?.result as bigint) ?? 0n,
        keeperActive: Boolean(statsUrl()),
      },
      waterfall: merged.slice(0, 50),
      loading: reads.isLoading && !reads.data,
      connected: isConnected,
      address,
      chainId: chainId ?? 0,
      wrongNetwork,
      reconnecting: reads.isError,
      paused: Boolean(reads.data?.paused?.result),
      impaired,
      faucetCooldownSec: 0,
      hullMeta: EMPTY_META,
      balMeta: EMPTY_META,
      toasts,
      deposit: (amount: bigint, kind: DeckKind) =>
        kind === "hull" ? joinHull(amount) : joinBallast(amount),
      withdraw: (shares: bigint, kind: DeckKind) =>
        kind === "hull" ? exitHull(shares) : exitBallast(shares),
      faucet: () =>
        runTx("Faucet", () =>
          writeContractAsync({
            address: ADDRESSES.DemoUSD,
            abi: demoAbi,
            functionName: "faucet",
            gas: GAS.faucet,
          }),
        ),
      joinHull,
      joinBallast,
      exitHull,
      exitBallast,
      crank: () =>
        runTx("Crank", () =>
          writeContractAsync({
            address: ADDRESSES.EngineLite,
            abi: engineAbi,
            functionName: "crank",
            gas: GAS.crank,
          }),
        ),
      deployLiquidity: () =>
        runTx("Deploy hedge", () =>
          writeContractAsync({
            address: ADDRESSES.EngineLite,
            abi: engineAbi,
            functionName: "deployLiquidity",
            gas: GAS.deployLiquidity,
          }),
        ),
      connect: async () => {
        try {
          const c = connectors[0];
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
            const eth = (window as unknown as { ethereum?: { request: (args: unknown) => Promise<unknown> } })
              .ethereum;
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
    address,
    chainId,
    connectors,
    connectAsync,
    disconnect,
    dismissToast,
    ensureApprove,
    impaired,
    isConnected,
    liveEvents,
    logs.data,
    reads.data,
    reads.isError,
    reads.isLoading,
    runTx,
    switchChainAsync,
    toasts,
    wrongNetwork,
    writeContractAsync,
  ]);

  return <VesselContext.Provider value={value}>{children}</VesselContext.Provider>;
}
