/**
 * Market-data WS — separate socket, separate limits (10 req/min, 16 subs).
 * Never share the trading connection. No application pings (data keeps alive).
 */
import WebSocket from "ws";
import type { RequestBudget } from "./budget.ts";

export type BookTop = {
  bestBid: number | null;
  bestAsk: number | null;
  /** Rough exit depth in quote units (6dec scale when known). */
  exitDepthQuote: bigint;
  updatedAt: number;
};

export class MarketDataClient {
  private ws: WebSocket | null = null;
  private book: BookTop = {
    bestBid: null,
    bestAsk: null,
    exitDepthQuote: 0n,
    updatedAt: 0,
  };

  constructor(
    private readonly wsUrl: string,
    private readonly marketId: number,
    private readonly budget: RequestBudget,
  ) {}

  getBook(): BookTop {
    return { ...this.book };
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.wsUrl}/ws/v1/market-data`;
      this.ws = new WebSocket(url);
      this.ws.on("open", () => {
        const spend = this.budget.trySpend("md-subscribe");
        if (!spend.ok) {
          reject(new Error("market-data budget exhausted on subscribe"));
          return;
        }
        this.ws!.send(
          JSON.stringify({
            mt: 5,
            subs: [{ stream: `order-book@${this.marketId}`, subscribe: true }],
          }),
        );
        resolve();
      });
      this.ws.on("message", (data) => this.onMessage(String(data)));
      this.ws.on("error", (err) => reject(err));
    });
  }

  private onMessage(raw: string): void {
    let msg: { mt?: number; bid?: Array<{ p: number; s: number }>; ask?: Array<{ p: number; s: number }> };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.mt !== 15 && msg.mt !== 16) return;
    const bids = msg.bid ?? [];
    const asks = msg.ask ?? [];
    const bestBid = bids.length ? Math.max(...bids.map((l) => l.p)) : this.book.bestBid;
    const bestAsk = asks.length ? Math.min(...asks.map((l) => l.p)) : this.book.bestAsk;
    // Sum ask sizes as a crude depth proxy (scaled size units — treated as quote-ish for policy).
    const depth = asks.reduce((a, l) => a + BigInt(Math.max(0, l.s)), 0n);
    this.book = {
      bestBid,
      bestAsk,
      exitDepthQuote: depth > 0n ? depth : this.book.exitDepthQuote,
      updatedAt: Date.now(),
    };
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
