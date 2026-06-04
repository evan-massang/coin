import type { Suggestion } from "../types.js";
import type { Services } from "../services.js";
import { analyzePerformance, type Insight } from "./performanceAnalyzer.js";
import { log } from "../util/logger.js";

// §1.12 Adaptive thresholds. Two modes:
//   • Manual Review (default): emit suggestions; the user applies them.
//   • Auto-Tune (opt-in, bounded): apply SMALL changes within HARD rails —
//       max ±5% change/day, never disable safety, never drop organic below the
//       floor, never auto-increase position size, every change logged.
// `clampAutoTune` encodes the rails and is unit-tested.

export interface AutoTuneRails {
  maxDailyPct: number;
  organicFloor: number;
}

export interface AutoTuneResult {
  allowed: boolean;
  to: number;
  reason: string;
}

/** Settings the auto-tuner must NEVER raise (position sizing). */
const POSITION_KEYS = new Set(["paperMaxPositionSol", "paperRiskPerTradePct"]);

export function clampAutoTune(setting: string, from: number, to: number, rails: AutoTuneRails): AutoTuneResult {
  // Never auto-increase position size.
  if (POSITION_KEYS.has(setting) && to > from) {
    return { allowed: false, to: from, reason: "auto-tune may not increase position size" };
  }

  const maxStep = Math.abs(from) * (rails.maxDailyPct / 100);
  if (maxStep <= 0) return { allowed: false, to: from, reason: "no step possible from 0" };

  const dir = Math.sign(to - from);
  if (dir === 0) return { allowed: false, to: from, reason: "no change" };

  let stepped = from + dir * Math.min(Math.abs(to - from), maxStep);

  // Never drop the organic score below the safe floor.
  if (setting === "minOrganicScore" && stepped < rails.organicFloor) {
    stepped = rails.organicFloor;
  }
  stepped = Math.round(stepped);
  if (stepped === from) return { allowed: false, to: from, reason: "clamped to no-op" };

  const pct = ((Math.abs(stepped - from) / Math.abs(from)) * 100).toFixed(1);
  return { allowed: true, to: stepped, reason: `auto-tune ${setting} ${from}→${stepped} (${pct}% ≤ ${rails.maxDailyPct}%/day)` };
}

export function suggestionsFromInsights(insights: Insight[], now: number): Suggestion[] {
  return insights.map((i) => ({
    at: now,
    kind: i.kind,
    setting: i.setting,
    from: i.from,
    to: i.to,
    rationale: i.rationale,
    status: "pending" as const,
  }));
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export interface AdaptiveOptions {
  intervalMs?: number;
  maxAutoChangesPerDay?: number;
}

export class AdaptiveThresholdEngine {
  private readonly intervalMs: number;
  private readonly maxAutoPerDay: number;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly svc: Services,
    opts: AdaptiveOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? 10 * 60_000;
    this.maxAutoPerDay = opts.maxAutoChangesPerDay ?? 3;
  }

  start(): void {
    this.timer = setInterval(() => this.runOnce(), this.intervalMs);
    log.ok("adaptive-threshold engine started");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  runOnce(now = Date.now()): void {
    const s = this.svc.settings.all();
    const features = this.svc.learning.features(3000);
    const insights = analyzePerformance(features, {
      minOrganicScore: s.minOrganicScore,
      maxLateEntryRisk: s.maxLateEntryRisk,
      weightHype: s.weightHype,
      weightSmartMoney: s.weightSmartMoney,
    });
    if (insights.length === 0) return;

    const pending = this.svc.learning.pendingSuggestions();
    const rails: AutoTuneRails = { maxDailyPct: s.autoTuneMaxDailyPct, organicFloor: s.organicFloor };
    const startOfDay = now - (now % 86_400_000);

    for (const sug of suggestionsFromInsights(insights, now)) {
      // De-dupe against existing pending suggestions for the same setting+target.
      if (pending.some((p) => p.setting === sug.setting && p.to === sug.to)) continue;

      if (s.learningMode === "manual") {
        this.svc.learning.addSuggestion(sug);
        continue;
      }

      // Auto-tune within rails.
      if (this.svc.learning.autoChangesSince(startOfDay) >= this.maxAutoPerDay) {
        this.svc.learning.addSuggestion(sug); // record, but don't apply (cap hit)
        continue;
      }
      const clamp = clampAutoTune(sug.setting, sug.from, sug.to, rails);
      if (!clamp.allowed) {
        this.svc.learning.addSuggestion(sug);
        continue;
      }
      this.svc.settings.update({ [sug.setting]: clamp.to } as never, "auto", clamp.reason);
      this.svc.learning.addSuggestion({ ...sug, to: clamp.to, status: "applied" });
    }

    this.svc.hub.broadcast("learning", { suggestions: this.svc.learning.pendingSuggestions().length });
  }
}
