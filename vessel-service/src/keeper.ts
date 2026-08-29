import { fileURLToPath } from "node:url";
import pino from "pino";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  formatEther,
  http,
  parseEther,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { engineLiteAbi, tranchesAbi } from "./abis.ts";
import {
  getChainId,
  getCrankIntervalSec,
  getKeeperPk,
  getRpcUrl,
  loadAddresses,
  vesselChain,
  type VesselAddresses,
} from "./addresses.ts";

const log = pino({ name: "keeper", level: process.env.LOG_LEVEL ?? "info" });

const GAS_CAP = 1_300_000n;
const MIN_BAL = parseEther("0.5");
const SKIP = new Set([
  "DtZero",
  "Paused",
  "NotWired",
  "AlreadyDeployed",
  "NothingDeployable",
]);
const DECODE_ABI = [...engineLiteAbi, ...tranchesAbi];

const BACKOFF_CAP_MS = 5 * 60 * 1000;

export type KeeperHandle = {
  stop: () => void;
  address: `0x${string}`;
  lastCrankTs: () => number | null;
};

let lastSuccessfulCrank: number | null = null;

export function getLastSuccessfulCrank(): number | null {
  return lastSuccessfulCrank;
}

function extractRevertData(err: unknown): `0x${string}` | undefined {
  if (err instanceof BaseError) {
    const hit = err.walk((e) => {
      const d = (e as { data?: unknown }).data;
      return typeof d === "string" && d.startsWith("0x") && d.length >= 10;
    }) as { data?: unknown } | null;
    if (typeof hit?.data === "string" && hit.data.startsWith("0x")) {
      return hit.data as `0x${string}`;
    }
  }
  const seen = new Set<unknown>();
  const walk = (v: unknown): `0x${string}` | undefined => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    const o = v as Record<string, unknown>;
    for (const key of ["data", "raw"] as const) {
      const x = o[key];
      if (typeof x === "string" && x.startsWith("0x") && x.length >= 10) {
        return x as `0x${string}`;
      }
      if (x && typeof x === "object") {
        const inner = (x as { data?: unknown }).data;
        if (typeof inner === "string" && inner.startsWith("0x") && inner.length >= 10) {
          return inner as `0x${string}`;
        }
      }
    }
    return walk(o.cause) || walk(o.error) || walk(o.data);
  };
  return walk(err);
}

export function decodeRevertReason(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) {
      return revert.data.errorName;
    }
  }
  const raw = extractRevertData(err);
  if (raw) {
    try {
      return decodeErrorResult({ abi: DECODE_ABI, data: raw }).errorName;
    } catch {
      /* not a known custom error */
    }
  }
  if (err instanceof BaseError) return err.shortMessage;
  return err instanceof Error ? err.message : String(err);
}

export function isRpcError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|network|ECONNRESET|ETIMEDOUT|ECONNREFUSED|429|502|503|504|timeout|http request|rpc/i.test(
    msg,
  );
}

function capGas(estimate: bigint): bigint {
  const scaled = (estimate * 13n) / 10n;
  if (scaled > GAS_CAP) return GAS_CAP;
  if (scaled === 0n) return GAS_CAP;
  return scaled;
}

export async function startKeeper(opts?: {
  publicClient?: PublicClient;
  addrs?: VesselAddresses;
}): Promise<KeeperHandle> {
  const pk = getKeeperPk();
  if (!pk) {
    log.error("KEEPER_PK is required");
    process.exit(1);
  }

  const rpcUrl = getRpcUrl();
  const chainId = getChainId();
  const addrs = opts?.addrs ?? loadAddresses();
  const chain = vesselChain(rpcUrl, chainId);
  const publicClient =
    opts?.publicClient ??
    createPublicClient({ chain, transport: http(rpcUrl) });
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const engine = addrs.contracts.EngineLite;
  const intervalSec = getCrankIntervalSec();
  const intervalMs = intervalSec * 1000;

  if (addrs.chainId !== chainId) {
    log.error(
      { addressesChainId: addrs.chainId, envChainId: chainId },
      "CHAIN_ID does not match ADDRESSES.json",
    );
    process.exit(1);
  }

  const onChain = await publicClient.getChainId();
  if (onChain !== chainId) {
    log.error({ onChain, envChainId: chainId }, "preflight: chainId mismatch");
    process.exit(1);
  }

  const code = await publicClient.getCode({ address: engine });
  if (!code || code === "0x") {
    log.error({ engine }, "preflight: no code at EngineLite");
    process.exit(1);
  }

  const bal = await publicClient.getBalance({ address: account.address });
  if (bal < MIN_BAL) {
    log.error(
      { keeper: account.address, balance: formatEther(bal) },
      "keeper MON < 0.5 — refuse to start (key is gas-only; fund it)",
    );
    process.exit(1);
  }

  log.info(
    {
      keeper: account.address,
      chain: chainId,
      engine,
      balance: formatEther(bal),
      intervalSec,
    },
    "preflight ok",
  );

  let inflight = false;
  let consecutiveFailures = 0;
  let rpcStreak = 0;
  let nextAllowedAt = 0;
  let cycle = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async () => {
    cycle += 1;
    const now = Date.now();

    if (inflight) {
      log.info({ cycle, fails: consecutiveFailures }, "heartbeat skip: in-flight crank");
      return;
    }
    if (now < nextAllowedAt) {
      log.info(
        { cycle, retryInMs: nextAllowedAt - now, fails: consecutiveFailures },
        "heartbeat backoff",
      );
      return;
    }

    inflight = true;
    try {
      const netDelta = (await publicClient.readContract({
        address: engine,
        abi: engineLiteAbi,
        functionName: "netDelta",
      })) as bigint;
      log.info(
        { cycle, netDelta: netDelta.toString(), fails: consecutiveFailures },
        "heartbeat",
      );

      const gasEst = await publicClient.estimateContractGas({
        address: engine,
        abi: engineLiteAbi,
        functionName: "crank",
        account,
      });
      const gas = capGas(gasEst);

      const hash = await wallet.writeContract({
        address: engine,
        abi: engineLiteAbi,
        functionName: "crank",
        gas,
        chain,
        account,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      consecutiveFailures = 0;
      rpcStreak = 0;
      nextAllowedAt = 0;
      lastSuccessfulCrank = Math.floor(Date.now() / 1000);
      log.info(
        { hash, status: receipt.status, gasLimit: gas.toString(), cycle },
        "cranked",
      );
    } catch (err) {
      const reason = decodeRevertReason(err);
      if (SKIP.has(reason) || [...SKIP].some((n) => reason.includes(n))) {
        consecutiveFailures = 0;
        rpcStreak = 0;
        nextAllowedAt = 0;
        log.warn({ cycle, reason }, "KEEPER-SKIP");
        log.info({ cycle, reason, fails: 0 }, "heartbeat skip revert");
      } else if (isRpcError(err)) {
        consecutiveFailures += 1;
        rpcStreak += 1;
        const delay = Math.min(intervalMs * 2 ** rpcStreak, BACKOFF_CAP_MS);
        nextAllowedAt = Date.now() + delay;
        log.error(
          { cycle, reason, fails: consecutiveFailures, backoffMs: delay },
          "heartbeat rpc error",
        );
        if (consecutiveFailures >= 3) {
          log.fatal("three consecutive unexpected failures — exiting so the supervisor restarts");
          process.exit(1);
        }
      } else {
        consecutiveFailures += 1;
        rpcStreak = 0;
        log.error({ cycle, reason, fails: consecutiveFailures }, "heartbeat fail");
        if (consecutiveFailures >= 3) {
          log.fatal("three consecutive unexpected failures — exiting so the supervisor restarts");
          process.exit(1);
        }
      }
    } finally {
      inflight = false;
    }
  };

  await tick();
  timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop: () => {
      if (timer) clearInterval(timer);
    },
    address: account.address,
    lastCrankTs: () => lastSuccessfulCrank,
  };
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === entry || /keeper\.[cm]?js$/.test(entry) || /keeper\.ts$/.test(entry);
}

if (isMain()) {
  void startKeeper().catch((err) => {
    log.fatal({ err }, "keeper failed");
    process.exit(1);
  });
}
