import type { Services } from "../services.js";
import type { FeatureRecord } from "../types.js";
import { fetchDexSnapshot } from "../sources/dexscreener.js";
import { RateLimiter } from "../util/rateLimiter.js";
import { log } from "../util/logger.js";

// §1.12 feature store + outcome tracking. The journal records a signal at alert
// time with a price; this tracker re-prices recent BUY/WATCH signals to fill the
// forward price path (max gain / drawdown) and, once resolved, writes a
// FeatureRecord — the data the performance analyzer learns from.

export class FeatureStore {
  constructor(private readonly svc: Services) {}

  record(f: FeatureRecord): void {
    this.svc.learning.addFeature(f);
  }
}

export interface OutcomeOptions {
  intervalMs?: number;
  resolveAfterMs?: number;
  maxPerTick?: number;
}

export class OutcomeTracker {
  private readonly store: FeatureStore;
  private readonly peaks = new Map<number, { peak: number; trough: number }>();
  private readonly recorded = new Set<number>();
  private readonly limiter = new RateLimiter(4);
  private readonly intervalMs: number;
  private readonly resolveAfterMs: number;
  private readonly maxPerTick: number;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly svc: Services,
    opts: OutcomeOptions = {},
  ) {
    this.store = new FeatureStore(svc);
    this.intervalMs = opts.intervalMs ?? 30_000;
    this.resolveAfterMs = opts.resolveAfterMs ?? 60 * 60_000;
    this.maxPerTick = opts.maxPerTick ?? 8;
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    log.ok("outcome tracker started (fills journal price path + learning features)");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    const recent = this.svc.signals
      .recent(150)
      .filter(
        (s) =>
          !this.recorded.has(s.id) &&
          s.priceAtAlert &&
          s.priceAtAlert > 0 &&
          ["BUY_SMALL", "BUY_STRONG", "WATCH_ONLY"].includes(s.verdict),
      );

    let priced = 0;
    for (const s of recent) {
      const elapsed = now - s.at;
      if (elapsed > this.resolveAfterMs) {
        this.finalize(s.id, s, now);
        continue;
      }
      if (priced >= this.maxPerTick || !this.limiter.tryAcquire()) continue;
      priced++;
      const snap = await fetchDexSnapshot(s.mint).catch(() => undefined);
      if (!snap?.priceUsd) continue;

      const track = this.peaks.get(s.id) ?? { peak: s.priceAtAlert!, trough: s.priceAtAlert! };
      track.peak = Math.max(track.peak, snap.priceUsd);
      track.trough = Math.min(track.trough, snap.priceUsd);
      this.peaks.set(s.id, track);

      const maxGainPct = (track.peak / s.priceAtAlert! - 1) * 100;
      const maxDrawdownPct = track.peak > 0 ? ((track.peak - track.trough) / track.peak) * 100 : 0;
      const path: { price5m?: number; price15m?: number; price1h?: number; maxGainPct: number; maxDrawdownPct: number } = {
        maxGainPct,
        maxDrawdownPct,
      };
      const min = elapsed / 60_000;
      if (min >= 5 && s.price5m == null) path.price5m = snap.priceUsd;
      if (min >= 15 && s.price15m == null) path.price15m = snap.priceUsd;
      if (min >= 60 && s.price1h == null) path.price1h = snap.priceUsd;
      this.svc.signals.updatePricePath(s.id, path);
    }
  }

  private finalize(id: number, s: ReturnType<Services["signals"]["recent"]>[number], now: number): void {
    if (this.recorded.has(id)) return;
    this.recorded.add(id);
    const track = this.peaks.get(id);
    const maxGainPct = track && s.priceAtAlert ? (track.peak / s.priceAtAlert - 1) * 100 : (s.maxGainPct ?? 0);
    const maxDrawdownPct = track && track.peak > 0 ? ((track.peak - track.trough) / track.peak) * 100 : (s.maxDrawdownPct ?? 0);
    this.store.record({
      mint: s.mint,
      at: s.at,
      verdict: s.verdict,
      scores: s.scores,
      entryPriceUsd: s.priceAtAlert,
      maxGainPct,
      maxDrawdownPct,
      holdMs: now - s.at,
      source: "signal",
    });

    // Record a replay event (Phase 6) for deterministic strategy backtests.
    this.svc.events.record({
      mint: s.mint,
      at: s.at,
      verdict: s.verdict,
      scores: s.scores,
      safetyPass: s.scores.safety > 0,
      unknownCount: s.flags?.includes("safety-unknowns") ? 2 : 0,
      maxGainPct,
      maxDrawdownPct,
      holdMs: now - s.at,
    });

    // Close the scam-memory feedback loop (Phase 5): classify the outcome and
    // update the deployer history + token fingerprint.
    const outcome: "rug" | "winner" | undefined =
      maxGainPct >= 100 ? "winner" : maxDrawdownPct >= 80 ? "rug" : undefined;
    if (outcome) {
      const creator = this.svc.tokens.get(s.mint)?.creator;
      if (creator) this.svc.creatorHistory.recordOutcome(creator, outcome);
      this.svc.fingerprints.markOutcome(s.mint, outcome);
    }

    // Resolve any AI-council opinions on this mint → per-seat accuracy (Phase 7).
    const councilOutcome: "win" | "loss" | undefined =
      maxGainPct >= 100 ? "win" : maxDrawdownPct >= 50 ? "loss" : undefined;
    if (councilOutcome) this.svc.council.resolve(s.mint, councilOutcome, maxGainPct);

    this.peaks.delete(id);
  }
}
