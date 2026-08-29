import { fileURLToPath } from "node:url";
import pino from "pino";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  formatEther,
  formatGwei,
  http,
  WaitForTransactionReceiptTimeoutError,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { engineLiteAbi, tranchesAbi } from "./abis.ts";
import {
  getChainId,
  getCrankIntervalSec,
  getKeeperPk,
  getMaxGasPriceGwei,
  getMinCranksRunway,
  getRpcUrl,
  loadAddresses,
  vesselChain,
  type VesselAddresses,
} from "./addresses.ts";

const log = pino({ name: "keeper", level: process.env.LOG_LEVEL ?? "info" });

/** Absolute ceiling on the gas limit we will ever put on a crank. */
const GAS_CAP = 1_300_000n;

/**
 * Monad charges gas_limit * price_per_gas — the LIMIT, not the gas used. Every
 * wei of headroom above the true cost is money burned on every single crank, so
 * the buffer over eth_estimateGas is 10% (the maximum the Monad gas skill
 * allows), not the 30% this used to send.
 */
const GAS_BUFFER_NUM = 11n;
const GAS_BUFFER_DEN = 10n;

/** Replacement txs need a strictly higher fee; 12.5% clears the usual 10% floor. */
const REPLACE_BUMP_NUM = 9n;
const REPLACE_BUMP_DEN = 8n;

/** Consecutive receipt timeouts before we hand the process to the supervisor. */
const MAX_STUCK_CYCLES = 5;

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

/**
 * Gas runway priced off the gas LIMIT. Every field is null rather than 0 when
 * it could not be read — a fabricated 0 here reads as "out of gas".
 */
export type KeeperStatus = {
  configured: boolean;
  running: boolean;
  address: `0x${string}` | null;
  balanceWei: string | null;
  balanceMon: string | null;
  /** The limit we actually put on the tx: min(estimate * 1.1, GAS_CAP). */
  gasLimit: string | null;
  gasPriceWei: string | null;
  gasPriceGwei: string | null;
  /** gasLimit * gasPrice. What one crank costs on Monad, win or lose. */
  costPerCrankWei: string | null;
  costPerCrankMon: string | null;
  cranksRemaining: number | null;
  minCranksRunway: number;
  lastRunwayAt: number | null;
  lastSuccessfulCrank: number | null;
  /** Hash of a crank that blew its receipt timeout and has not been resolved. */
  stuckTxHash: string | null;
  lastError: string | null;
};

const status: KeeperStatus = {
  configured: false,
  running: false,
  address: null,
  balanceWei: null,
  balanceMon: null,
  gasLimit: null,
  gasPriceWei: null,
  gasPriceGwei: null,
  costPerCrankWei: null,
  costPerCrankMon: null,
  cranksRemaining: null,
  minCranksRunway: 0,
  lastRunwayAt: null,
  lastSuccessfulCrank: null,
  stuckTxHash: null,
  lastError: null,
};

export function getKeeperStatus(): KeeperStatus {
  return { ...status };
}

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

/** min(estimate * 1.1, GAS_CAP). A zero/absent estimate falls back to the cap. */
export function capGas(estimate: bigint): bigint {
  if (estimate <= 0n) return GAS_CAP;
  const scaled = (estimate * GAS_BUFFER_NUM) / GAS_BUFFER_DEN;
  return scaled > GAS_CAP ? GAS_CAP : scaled;
}

export type Runway = {
  balance: bigint;
  gasPrice: bigint;
  gasLimit: bigint;
  costPerCrank: bigint;
  cranksRemaining: number;
};

/**
 * Runway from the gas LIMIT, not from historical gas used. On Monad a crank
 * costs gas_limit * price_per_gas whether it uses the gas or not, so this is
 * the real number of cranks the balance still buys.
 */
export async function computeRunway(
  client: PublicClient,
  address: `0x${string}`,
  gasLimit: bigint,
): Promise<Runway> {
  const [balance, gasPrice] = await Promise.all([
    client.getBalance({ address }),
    client.getGasPrice(),
  ]);
  const costPerCrank = gasLimit * gasPrice;
  const cranksRemaining = costPerCrank === 0n ? 0 : Number(balance / costPerCrank);
  return { balance, gasPrice, gasLimit, costPerCrank, cranksRemaining };
}

function recordRunway(r: Runway): void {
  status.balanceWei = r.balance.toString();
  status.balanceMon = formatEther(r.balance);
  status.gasPriceWei = r.gasPrice.toString();
  status.gasPriceGwei = formatGwei(r.gasPrice);
  status.gasLimit = r.gasLimit.toString();
  status.costPerCrankWei = r.costPerCrank.toString();
  status.costPerCrankMon = formatEther(r.costPerCrank);
  status.cranksRemaining = r.cranksRemaining;
  status.lastRunwayAt = Math.floor(Date.now() / 1000);
}

function runwayFields(r: Runway) {
  return {
    gasLimit: r.gasLimit.toString(),
    gasPriceWei: r.gasPrice.toString(),
    gasPriceGwei: formatGwei(r.gasPrice),
    costPerCrankMon: formatEther(r.costPerCrank),
    balanceMon: formatEther(r.balance),
    cranksRemaining: r.cranksRemaining,
  };
}

type Fees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

/** EIP-1559 fees, falling back to a legacy gas price if the node has no 1559 data. */
async function currentFees(client: PublicClient): Promise<Fees> {
  try {
    const f = await client.estimateFeesPerGas();
    if (f.maxFeePerGas !== undefined && f.maxPriorityFeePerGas !== undefined) {
      return { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas };
    }
  } catch {
    /* fall through to legacy pricing */
  }
  const gp = await client.getGasPrice();
  return { maxFeePerGas: gp, maxPriorityFeePerGas: gp / 10n };
}

function bumpFees(previous: Fees, current: Fees): Fees {
  const bump = (prev: bigint, now: bigint): bigint => {
    const floor = (prev * REPLACE_BUMP_NUM) / REPLACE_BUMP_DEN + 1n;
    return now > floor ? now : floor;
  };
  return {
    maxFeePerGas: bump(previous.maxFeePerGas, current.maxFeePerGas),
    maxPriorityFeePerGas: bump(previous.maxPriorityFeePerGas, current.maxPriorityFeePerGas),
  };
}

type PendingTx = { hash: Hex; nonce: number; gas: bigint; fees: Fees; sentAt: number };

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
    opts?.publicClient ?? createPublicClient({ chain, transport: http(rpcUrl) });
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const engine = addrs.contracts.EngineLite;
  const intervalSec = getCrankIntervalSec();
  const intervalMs = intervalSec * 1000;
  const minRunway = getMinCranksRunway();
  const maxFeeCapWei = BigInt(getMaxGasPriceGwei()) * 1_000_000_000n;

  // ~2 crank intervals, clamped so a tiny or enormous CRANK_INTERVAL_SEC still
  // yields a sane receipt timeout.
  const receiptTimeoutMs = Math.max(30_000, Math.min(2 * intervalMs, 15 * 60_000));

  status.configured = true;
  status.address = account.address;
  status.minCranksRunway = minRunway;

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

  // Budget off the limit we would actually send. crank() can legitimately
  // revert right now (Paused/DtZero/...), in which case we budget at the
  // absolute cap — the conservative direction.
  let budgetGasLimit = GAS_CAP;
  let gasLimitSource = "GAS_CAP (estimate unavailable)";
  try {
    const est = await publicClient.estimateContractGas({
      address: engine,
      abi: engineLiteAbi,
      functionName: "crank",
      account,
    });
    budgetGasLimit = capGas(est);
    gasLimitSource = `eth_estimateGas ${est.toString()} + 10%`;
  } catch (err) {
    log.warn(
      { reason: decodeRevertReason(err) },
      "preflight: crank gas estimate unavailable — budgeting at GAS_CAP",
    );
  }

  const runway = await computeRunway(publicClient, account.address, budgetGasLimit);
  recordRunway(runway);

  log.info(
    {
      keeper: account.address,
      chain: chainId,
      engine,
      intervalSec,
      receiptTimeoutMs,
      gasLimitSource,
      minCranksRunway: minRunway,
      maxFeeCapGwei: getMaxGasPriceGwei(),
      ...runwayFields(runway),
    },
    "preflight: gas runway (Monad charges the LIMIT, not gas used)",
  );

  if (runway.cranksRemaining < minRunway) {
    log.error(
      { minCranksRunway: minRunway, ...runwayFields(runway) },
      "keeper gas runway below MIN_CRANKS_RUNWAY — refuse to start (key is gas-only; fund it)",
    );
    process.exit(1);
  }

  log.info({ keeper: account.address, chain: chainId, engine }, "preflight ok");
  status.running = true;

  let inflight = false;
  let consecutiveFailures = 0;
  let rpcStreak = 0;
  let nextAllowedAt = 0;
  let cycle = 0;
  let pending: PendingTx | null = null;
  let stuckCycles = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  /**
   * A receipt means the tx landed — not that the crank worked. A reverted crank
   * still burned gas_limit * price on Monad and advanced nothing, so it must not
   * refresh lastSuccessfulCrank; /health would otherwise report a healthy crank
   * cadence while the engine sat still.
   */
  const recordReceipt = (hash: Hex, gas: bigint, receiptStatus: string) => {
    pending = null;
    status.stuckTxHash = null;
    stuckCycles = 0;
    rpcStreak = 0;

    if (receiptStatus !== "success") {
      consecutiveFailures += 1;
      status.lastError = `crank reverted on-chain (${hash})`;
      log.error(
        { hash, status: receiptStatus, gasLimit: gas.toString(), cycle, fails: consecutiveFailures },
        "crank reverted on-chain — gas spent at the limit, no crank recorded",
      );
      if (consecutiveFailures >= 3) {
        log.fatal("three consecutive unexpected failures — exiting so the supervisor restarts");
        process.exit(1);
      }
      return;
    }

    consecutiveFailures = 0;
    nextAllowedAt = 0;
    status.lastError = null;
    lastSuccessfulCrank = Math.floor(Date.now() / 1000);
    status.lastSuccessfulCrank = lastSuccessfulCrank;
    log.info({ hash, status: receiptStatus, gasLimit: gas.toString(), cycle }, "cranked");
  };

  const tick = async () => {
    cycle += 1;
    const now = Date.now();

    // Exactly one crank in flight at a time. Every exit path below runs the
    // finally that clears this, including the receipt-timeout path.
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
      // ---- resolve a previously-stuck tx before doing anything else ----
      if (pending) {
        const settled = await publicClient
          .getTransactionReceipt({ hash: pending.hash })
          .catch(() => null);
        if (settled) {
          recordReceipt(pending.hash, pending.gas, settled.status);
          return;
        }
        const minedNonce = await publicClient.getTransactionCount({
          address: account.address,
          blockTag: "latest",
        });
        if (minedNonce > pending.nonce) {
          // Something else already consumed that nonce (a replacement landed,
          // or the tx was mined and the receipt lookup lost a race).
          log.warn(
            { cycle, stuckTx: pending.hash, nonce: pending.nonce, minedNonce },
            "stuck nonce already consumed on-chain — clearing and sending fresh",
          );
          pending = null;
          status.stuckTxHash = null;
        }
      }

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

      // Runway is recomputed every cycle from the limit we are about to send.
      const cycleRunway = await computeRunway(publicClient, account.address, gas);
      recordRunway(cycleRunway);
      if (cycleRunway.cranksRemaining < minRunway) {
        log.warn(
          { cycle, minCranksRunway: minRunway, ...runwayFields(cycleRunway) },
          "KEEPER-LOW-RUNWAY: keeper MON buys fewer than MIN_CRANKS_RUNWAY cranks — fund the key",
        );
      }

      const fees = await currentFees(publicClient);
      const send = pending ? bumpFees(pending.fees, fees) : fees;
      if (send.maxFeePerGas > maxFeeCapWei) {
        log.error(
          {
            cycle,
            maxFeePerGasGwei: formatGwei(send.maxFeePerGas),
            capGwei: getMaxGasPriceGwei(),
          },
          "KEEPER-FEE-CAP: required fee exceeds MAX_GAS_PRICE_GWEI — skipping this cycle",
        );
        return;
      }

      // viem picks the nonce from eth_getTransactionCount(pending) when we do
      // not supply one. If a stuck tx is still in the mempool that returns
      // nonce+1, so the fresh crank would QUEUE BEHIND the stuck one instead of
      // clearing it (and two cranks could eventually land). We therefore reuse
      // the stuck nonce with a bumped fee: a same-nonce replacement, so at most
      // one crank can ever land. If the stuck tx was dropped from the mempool,
      // the pending count has already fallen back to that nonce and this is
      // just a normal send.
      const nonce = pending
        ? pending.nonce
        : await publicClient.getTransactionCount({
            address: account.address,
            blockTag: "pending",
          });

      if (pending) {
        log.warn(
          {
            cycle,
            replacing: pending.hash,
            stuckForMs: Date.now() - pending.sentAt,
            nonce,
            maxFeePerGasGwei: formatGwei(send.maxFeePerGas),
          },
          "replacing stuck crank at the same nonce with a bumped fee",
        );
      }

      const hash = await wallet.writeContract({
        address: engine,
        abi: engineLiteAbi,
        functionName: "crank",
        gas,
        nonce,
        maxFeePerGas: send.maxFeePerGas,
        maxPriorityFeePerGas: send.maxPriorityFeePerGas,
        chain,
        account,
      });

      let receipt;
      try {
        receipt = await publicClient.waitForTransactionReceipt({
          hash,
          timeout: receiptTimeoutMs,
        });
      } catch (waitErr) {
        if (waitErr instanceof WaitForTransactionReceiptTimeoutError) {
          pending = { hash, nonce, gas, fees: send, sentAt: Date.now() };
          stuckCycles += 1;
          status.stuckTxHash = hash;
          status.lastError = `receipt timeout after ${receiptTimeoutMs}ms`;
          log.error(
            { cycle, hash, nonce, timeoutMs: receiptTimeoutMs, stuckCycles },
            "KEEPER-STUCK: no receipt within timeout — releasing the loop; next cycle re-checks then replaces at the same nonce",
          );
          if (stuckCycles >= MAX_STUCK_CYCLES) {
            log.fatal(
              { stuckCycles, hash },
              "crank stuck for too many cycles — exiting so the supervisor restarts",
            );
            process.exit(1);
          }
          return; // finally clears inflight; the next cycle proceeds
        }
        throw waitErr;
      }

      recordReceipt(hash, gas, receipt.status);
    } catch (err) {
      const reason = decodeRevertReason(err);
      status.lastError = reason;
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
      status.running = false;
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
