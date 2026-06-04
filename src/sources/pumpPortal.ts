import WebSocket from "ws";
import { config } from "../config.js";
import { log } from "../util/logger.js";
import type { NewToken, TradeEvent } from "../types.js";

type Handlers = {
  onNewToken?: (t: NewToken) => void;
  onTrade?: (t: TradeEvent) => void;
};

/**
 * Reconnecting client for the free PumpPortal realtime feed. One socket serves
 * three roles: the new-token stream (scanner), per-mint trade streams (momentum
 * for safety-gate survivors), and per-wallet trade streams (observer/copy).
 *
 * Metered streams are bounded to survivors + a small watched-wallet set
 * (Part 10), so token/wallet subscriptions are added/removed dynamically.
 */
export class PumpPortalClient {
  private ws?: WebSocket;
  private handlers: Handlers = {};
  private subscribeNewToken = false;
  private readonly watchedWallets = new Set<string>();
  private readonly watchedTokens = new Set<string>();
  private closed = false;
  private backoffMs = 1000;

  constructor(opts: { newTokens?: boolean; wallets?: string[] } = {}) {
    this.subscribeNewToken = opts.newTokens ?? false;
    for (const w of opts.wallets ?? []) this.watchedWallets.add(w);
  }

  on(handlers: Handlers): this {
    this.handlers = { ...this.handlers, ...handlers };
    return this;
  }

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    this.ws?.close();
  }

  private get ready(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ready) this.ws!.send(JSON.stringify(payload));
  }

  /** Subscribe to a mint's trade stream (called for safety-gate survivors). */
  watchToken(mint: string): void {
    if (this.watchedTokens.has(mint)) return;
    this.watchedTokens.add(mint);
    this.send({ method: "subscribeTokenTrade", keys: [mint] });
  }

  unwatchToken(mint: string): void {
    if (!this.watchedTokens.delete(mint)) return;
    this.send({ method: "unsubscribeTokenTrade", keys: [mint] });
  }

  watchWallet(address: string): void {
    if (this.watchedWallets.has(address)) return;
    this.watchedWallets.add(address);
    this.send({ method: "subscribeAccountTrade", keys: [address] });
  }

  unwatchWallet(address: string): void {
    if (!this.watchedWallets.delete(address)) return;
    this.send({ method: "unsubscribeAccountTrade", keys: [address] });
  }

  get watchedTokenCount(): number {
    return this.watchedTokens.size;
  }

  private connect(): void {
    log.info(`connecting to PumpPortal: ${config.pumpportalWs}`);
    const ws = new WebSocket(config.pumpportalWs);
    this.ws = ws;

    ws.on("open", () => {
      this.backoffMs = 1000;
      log.ok("PumpPortal connected");
      if (this.subscribeNewToken) this.send({ method: "subscribeNewToken" });
      if (this.watchedWallets.size > 0)
        this.send({ method: "subscribeAccountTrade", keys: [...this.watchedWallets] });
      if (this.watchedTokens.size > 0)
        this.send({ method: "subscribeTokenTrade", keys: [...this.watchedTokens] });
    });

    ws.on("message", (data) => this.handleMessage(data.toString()));
    ws.on("error", (err) => log.err(`PumpPortal error: ${(err as Error).message}`));
    ws.on("close", () => {
      if (this.closed) return;
      log.warn(`PumpPortal closed — reconnecting in ${this.backoffMs}ms`);
      setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    });
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.message) return; // subscription ack / info text

    const txType = (msg.txType ?? msg.type) as string | undefined;
    const mint = msg.mint as string | undefined;
    if (!mint) return;

    if (txType === "create" && this.handlers.onNewToken) {
      this.handlers.onNewToken({
        mint,
        name: msg.name as string | undefined,
        symbol: msg.symbol as string | undefined,
        creator: msg.traderPublicKey as string | undefined,
        uri: msg.uri as string | undefined,
        initialBuySol: numOrUndef(msg.solAmount),
        marketCapSol: numOrUndef(msg.marketCapSol),
        pool: msg.pool as string | undefined,
        seenAt: Date.now(),
      });
      return;
    }

    if ((txType === "buy" || txType === "sell") && this.handlers.onTrade) {
      this.handlers.onTrade({
        mint,
        trader: (msg.traderPublicKey as string) ?? "",
        side: txType,
        solAmount: numOrUndef(msg.solAmount),
        tokenAmount: numOrUndef(msg.tokenAmount),
        marketCapSol: numOrUndef(msg.marketCapSol),
        signature: msg.signature as string | undefined,
        at: Date.now(),
      });
    }
  }
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
