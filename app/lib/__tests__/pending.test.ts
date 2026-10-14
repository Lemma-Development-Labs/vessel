import { describe, expect, it } from "vitest";
import { forgetPending, loadPending, pendingFor, rememberPending, type PendingTx } from "../book/pending";

class MemStore {
  data = new Map<string, string>();
  failWrites = false;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new Error("QuotaExceeded");
    this.data.set(k, v);
  }
}

const tx = (n: number, over: Partial<PendingTx> = {}): PendingTx => ({
  hash: `0x${n.toString(16).padStart(64, "0")}`,
  label: `tx ${n}`,
  chainId: 10143,
  account: "0x000000000000000000000000000000000000A11C",
  submittedAt: 1_800_000_000,
  ...over,
});

describe("pending transaction memory", () => {
  it("remembers, restores per wallet and chain, and forgets after a receipt", () => {
    const s = new MemStore();
    rememberPending(tx(1), s);
    rememberPending(tx(2, { account: "0x000000000000000000000000000000000000B0B0" }), s);
    rememberPending(tx(3, { chainId: 143 }), s);
    // Address case does not matter; other wallets and chains are not mixed in.
    expect(pendingFor("0x000000000000000000000000000000000000a11c", 10143, s).map((p) => p.label)).toEqual(["tx 1"]);
    forgetPending(tx(1).hash.toUpperCase().replace("0X", "0x"), s);
    expect(pendingFor("0x000000000000000000000000000000000000a11c", 10143, s)).toEqual([]);
  });

  it("re-remembering the same hash does not duplicate it", () => {
    const s = new MemStore();
    rememberPending(tx(1), s);
    rememberPending(tx(1, { label: "again" }), s);
    expect(loadPending(s)).toHaveLength(1);
  });

  it("corrupt or hostile stored data is ignored, not trusted", () => {
    const s = new MemStore();
    s.data.set("vessel.pendingTx.v1", "{not json");
    expect(loadPending(s)).toEqual([]);
    s.data.set("vessel.pendingTx.v1", JSON.stringify([{ hash: "0xnothex", label: 1 }, tx(5)]));
    expect(loadPending(s).map((p) => p.label)).toEqual(["tx 5"]);
  });

  it("blocked or full storage never throws into the transaction flow", () => {
    const s = new MemStore();
    s.failWrites = true;
    expect(() => rememberPending(tx(1), s)).not.toThrow();
    expect(() => forgetPending(tx(1).hash, s)).not.toThrow();
    expect(loadPending(null)).toEqual([]);
    expect(pendingFor(undefined, 10143, s)).toEqual([]);
  });

  it("keeps a bounded history", () => {
    const s = new MemStore();
    for (let i = 1; i <= 30; i++) rememberPending(tx(i), s);
    const all = loadPending(s);
    expect(all).toHaveLength(20);
    expect(all.at(-1)?.label).toBe("tx 30");
  });
});
