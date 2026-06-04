import { Connection, PublicKey } from "@solana/web3.js";
import type { Services } from "../services.js";
import type { WalletStatus } from "../types.js";
import { PositionManager } from "../engine/positionManager.js";
import { makeConnection, isValidSolanaAddress } from "../sources/solanaRpc.js";
import { getSolUsd } from "../sources/coingecko.js";
import { fetchDexSnapshot } from "../sources/dexscreener.js";
import { parseTxDeltas, type ParsedTxLike } from "./txParser.js";
import { detectActivities } from "./positionDetector.js";
import { RateLimiter } from "../util/rateLimiter.js";
import { log } from "../util/logger.js";

// Read-only wallet observer (Part 2). Polls a PUBLIC address, reconstructs
// buys/sells from public transactions, and tracks positions + PnL. It cannot
// buy, sell, or transfer — there is no signing path anywhere in this file.

export interface ObserverOptions {
  intervalMs?: number;
  backfillLimit?: number;
}

export class WalletObserver {
  private readonly manager: PositionManager;
  private readonly txLimiter: RateLimiter;
  private readonly intervalMs: number;
  private readonly backfillLimit: number;
  private timer?: NodeJS.Timeout;
  private lastSig?: string;
  private seededAddress?: string;
  private polling = false;

  constructor(
    private readonly svc: Services,
    opts: ObserverOptions = {},
  ) {
    this.manager = new PositionManager(svc.positions, "wallet");
    this.intervalMs = opts.intervalMs ?? 20_000;
    this.backfillLimit = opts.backfillLimit ?? 80;
    this.txLimiter = new RateLimiter(svc.settings.get("heliusApiKey") ? 30 : 6);
  }

  start(): void {
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    void this.poll();
    log.ok("wallet observer started (read-only)");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private setStatus(patch: Partial<WalletStatus>): void {
    this.svc.runtime.wallet = { ...this.svc.runtime.wallet, ...patch };
    this.svc.hub.broadcast("wallet", this.svc.runtime.wallet);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    const s = this.svc.settings.all();
    const address = s.walletAddress.trim();

    if (!s.walletObserverEnabled || !address) {
      this.setStatus({ address, connected: false, error: undefined });
      return;
    }
    if (!isValidSolanaAddress(address)) {
      this.setStatus({ address, connected: false, error: "invalid address" });
      return;
    }

    this.polling = true;
    try {
      const conn = makeConnection(s);
      const owner = new PublicKey(address);
      const solUsd = await getSolUsd();

      // Reset incremental cursor if the watched address changed.
      if (this.seededAddress !== address) {
        this.lastSig = undefined;
        this.seededAddress = address;
      }

      const firstRun = this.lastSig === undefined;
      const limit = firstRun ? this.backfillLimit : 25;
      const sigInfos = await conn.getSignaturesForAddress(owner, { limit, until: this.lastSig });
      if (sigInfos.length > 0) {
        // Process oldest → newest so cost basis builds correctly.
        const ordered = [...sigInfos].reverse();
        for (const si of ordered) {
          if (si.err) continue;
          await this.processSignature(conn, si.signature, address, solUsd);
        }
        this.lastSig = sigInfos[0]!.signature; // newest
      }

      // Mark open positions to market for live unrealized PnL.
      await this.markOpenPositions(solUsd);

      this.setStatus({ address, connected: true, lastCheckedMs: Date.now(), error: undefined });
    } catch (err) {
      this.setStatus({ connected: false, error: (err as Error).message, lastCheckedMs: Date.now() });
      log.warn(`wallet observer poll failed: ${(err as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  private async processSignature(conn: Connection, signature: string, owner: string, solUsd: number): Promise<void> {
    await this.txLimiter.acquire();
    const tx = (await conn
      .getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 })
      .catch(() => null)) as ParsedTxLike | null;
    if (!tx) return;
    const deltas = parseTxDeltas(tx, owner);
    if (!deltas) return;
    for (const act of detectActivities(deltas)) {
      const tokenInfo = this.svc.tokens.get(act.mint);
      const res = this.manager.applyActivity(act, { symbol: tokenInfo?.symbol, solUsd });
      if (res.marked === "entered") log.info(`wallet: entered ${act.mint.slice(0, 8)} (${act.tokenAmount.toFixed(0)} tokens)`);
      if (res.marked === "closed") log.info(`wallet: closed ${act.mint.slice(0, 8)}`);
      if (res.position) this.svc.hub.broadcast("position", res.position);
    }
  }

  private async markOpenPositions(solUsd: number): Promise<void> {
    const open = this.svc.positions.byStatus(true);
    for (const pos of open) {
      const snap = await fetchDexSnapshot(pos.mint).catch(() => undefined);
      if (snap?.priceUsd) {
        const priceSol = snap.priceUsd / solUsd;
        this.manager.markPrice(pos.mint, priceSol, solUsd);
      }
    }
  }
}
