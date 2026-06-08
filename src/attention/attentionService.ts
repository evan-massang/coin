import type { AttentionEvidence, AttentionScores } from "./types.js";
import { collectEvidence } from "./researchAgent.js";
import { computeAttention } from "./attentionAgent.js";
import { judgeAttention } from "./llmJudge.js";
import { log } from "../util/logger.js";

// Phase 1/16/17 — Autonomous research infrastructure. Coins that pass safety +
// scoring (WATCH/BUY) get queued for automatic attention research (NEVER AVOID,
// unless forced). The service dedupes, respects a TTL, runs one job at a time
// (browser/LLM are heavy), caches the AttentionScores, and fires onComplete so
// the engine can RE-SCORE with the new evidence. Read-only + best-effort.

export interface CoinRef {
  mint: string;
  symbol?: string;
  name?: string;
  /** Source verdict that shortlisted it (for transcript). */
  verdict?: string;
}

export interface AttentionRecord {
  mint: string;
  scores: AttentionScores;
  evidence: AttentionEvidence;
  at: number;
  source: "heuristic" | "llm";
}

export interface AttentionServiceOpts {
  /** Collect public evidence for a coin (default: free News+Wiki collector). */
  collect?: (coin: CoinRef) => Promise<AttentionEvidence>;
  /** Score the evidence (default: LLM judge if configured, else heuristic). */
  score?: (ev: AttentionEvidence) => Promise<{ scores: AttentionScores; source: "heuristic" | "llm" }>;
  /** Re-research a coin only if its cached record is older than this. */
  ttlMs?: number;
  /** Master enable (default true). */
  enabled?: () => boolean;
  /** Fired after each completed research (re-score + transcript hooks). */
  onComplete?: (rec: AttentionRecord) => void;
  /** Injectable clock for tests. */
  now?: () => number;
  /** Records to warm the in-memory cache on boot (from the durable store). */
  warm?: AttentionRecord[];
}

export class AttentionService {
  private readonly cache = new Map<string, AttentionRecord>();
  private readonly order: string[] = []; // mints, newest last (for recent())
  private readonly queued = new Set<string>();
  private readonly queue: CoinRef[] = [];
  private running = false;

  private readonly collect: (c: CoinRef) => Promise<AttentionEvidence>;
  private readonly score: (ev: AttentionEvidence) => Promise<{ scores: AttentionScores; source: "heuristic" | "llm" }>;
  private readonly ttlMs: number;
  private readonly enabled: () => boolean;
  private readonly onComplete?: (rec: AttentionRecord) => void;
  private readonly now: () => number;

  constructor(opts: AttentionServiceOpts = {}) {
    this.collect = opts.collect ?? ((c) => collectEvidence(c, {}));
    this.score = opts.score ?? (async (ev) => ({ scores: computeAttention(ev), source: "heuristic" as const }));
    this.ttlMs = opts.ttlMs ?? 30 * 60_000;
    this.enabled = opts.enabled ?? (() => true);
    this.onComplete = opts.onComplete;
    this.now = opts.now ?? (() => Date.now());
    // Warm the cache from the durable store (newest-first ⇒ reverse for chrono order).
    for (const rec of [...(opts.warm ?? [])].reverse()) {
      this.cache.set(rec.mint, rec);
      this.order.push(rec.mint);
    }
  }

  /** Cached attention for a mint (undefined if never/expired — caller degrades). */
  get(mint: string): AttentionScores | undefined {
    return this.cache.get(mint)?.scores;
  }

  record(mint: string): AttentionRecord | undefined {
    return this.cache.get(mint);
  }

  /** Most-recently-researched coins, newest first (for the dashboard/transcript). */
  recent(limit = 40): AttentionRecord[] {
    const out: AttentionRecord[] = [];
    for (let i = this.order.length - 1; i >= 0 && out.length < limit; i--) {
      const rec = this.cache.get(this.order[i]);
      if (rec) out.push(rec);
    }
    return out;
  }

  /** Enqueue research for a shortlisted coin. Deduped + TTL-gated. `force` ignores both. */
  request(coin: CoinRef, force = false): void {
    if (!force && !this.enabled()) return;
    const fresh = this.cache.get(coin.mint);
    if (!force && fresh && this.now() - fresh.at < this.ttlMs) return; // still fresh
    if (this.queued.has(coin.mint)) return; // already pending
    this.queued.add(coin.mint);
    this.queue.push(coin);
    void this.pump();
  }

  get queueLength(): number {
    return this.queue.length;
  }

  /** Resolves when the worker has drained the queue (test/shutdown helper). */
  async whenIdle(): Promise<void> {
    while (this.running || this.queue.length > 0) await new Promise((r) => setTimeout(r, 1));
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const coin = this.queue.shift()!;
        try {
          const evidence = await this.collect(coin);
          const { scores, source } = await this.score(evidence);
          const rec: AttentionRecord = { mint: coin.mint, scores, evidence, at: this.now(), source };
          this.cache.set(coin.mint, rec);
          const oi = this.order.indexOf(coin.mint);
          if (oi >= 0) this.order.splice(oi, 1);
          this.order.push(coin.mint);
          if (this.order.length > 500) this.order.shift();
          try {
            this.onComplete?.(rec);
          } catch (e) {
            log.warn(`attention onComplete failed: ${(e as Error).message}`);
          }
        } catch (e) {
          log.warn(`attention research failed for ${coin.symbol ?? coin.mint}: ${(e as Error).message}`);
        } finally {
          this.queued.delete(coin.mint);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

/** Build the default scorer: local-LLM judge when a model is configured, else heuristic. */
export function makeScorer(cfg: () => { baseUrl: string; model: string }): (ev: AttentionEvidence) => Promise<{ scores: AttentionScores; source: "heuristic" | "llm" }> {
  return async (ev) => {
    const { baseUrl, model } = cfg();
    if (model) {
      const judged = await judgeAttention(ev, baseUrl, model);
      if (judged) return { scores: judged, source: "llm" };
    }
    return { scores: computeAttention(ev), source: "heuristic" };
  };
}
