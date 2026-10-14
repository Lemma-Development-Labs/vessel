/**
 * Submitted-transaction memory, so a page reload restores status from chain
 * evidence instead of forgetting a transaction mid-flight (spec §15:
 * "Unknown means reconcile; it must not invite blind resubmission").
 *
 * Browser storage is a per-viewer convenience only: it may be unavailable
 * (private window, blocked site data) and every access is guarded. The chain
 * stays the source of truth — this only remembers which hashes to ask about.
 */

export type PendingTx = {
  hash: `0x${string}`;
  label: string;
  chainId: number;
  account: string;
  /** Unix seconds when the wallet returned the hash. */
  submittedAt: number;
};

const KEY = "vessel.pendingTx.v1";
/** After this long without a receipt, stop polling and tell the user to check the explorer. */
export const RECONCILE_GIVE_UP_SEC = 30 * 60;
const MAX_ENTRIES = 20;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function store(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isPending(x: unknown): x is PendingTx {
  const o = x as Record<string, unknown>;
  return (
    !!o &&
    typeof o.hash === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(o.hash) &&
    typeof o.label === "string" &&
    typeof o.chainId === "number" &&
    typeof o.account === "string" &&
    typeof o.submittedAt === "number"
  );
}

export function loadPending(s: StorageLike | null = store()): PendingTx[] {
  if (!s) return [];
  try {
    const raw = JSON.parse(s.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter(isPending) : [];
  } catch {
    return [];
  }
}

function save(list: PendingTx[], s: StorageLike | null) {
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(list.slice(-MAX_ENTRIES)));
  } catch {
    /* storage full or blocked — status still comes from the live wait */
  }
}

export function rememberPending(tx: PendingTx, s: StorageLike | null = store()) {
  save([...loadPending(s).filter((p) => p.hash !== tx.hash), tx], s);
}

export function forgetPending(hash: string, s: StorageLike | null = store()) {
  save(
    loadPending(s).filter((p) => p.hash.toLowerCase() !== hash.toLowerCase()),
    s,
  );
}

/** The entries that belong to this wallet on this chain. */
export function pendingFor(account: string | undefined, chainId: number, s: StorageLike | null = store()): PendingTx[] {
  if (!account) return [];
  return loadPending(s).filter((p) => p.chainId === chainId && p.account.toLowerCase() === account.toLowerCase());
}
