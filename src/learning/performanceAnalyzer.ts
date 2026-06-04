import type { FeatureRecord } from "../types.js";

// §1.12 Performance analyzer. Correlates features/thresholds with outcomes
// (win rate, avg PnL) to find where the current settings are leaving money on
// the table or letting losers through. Pure. Emits Insights, not changes.

export interface AnalyzerSettings {
  minOrganicScore: number;
  maxLateEntryRisk: number;
  weightHype: number;
  weightSmartMoney: number;
}

export interface Insight {
  kind: string;
  setting: string;
  from: number;
  to: number;
  rationale: string;
}

const MIN_SAMPLE = 12;

function isWin(f: FeatureRecord): boolean {
  if (f.realizedPnlSol !== undefined) return f.realizedPnlSol > 0;
  return (f.maxGainPct ?? 0) >= 100;
}

function winRate(fs: FeatureRecord[]): number {
  return fs.length ? fs.filter(isWin).length / fs.length : 0;
}

/** Pearson correlation between a sub-score and the win outcome. */
function corrWithWin(fs: FeatureRecord[], pick: (f: FeatureRecord) => number): number {
  const n = fs.length;
  if (n < 2) return 0;
  const xs = fs.map(pick);
  const ys: number[] = fs.map((f) => (isWin(f) ? 1 : 0));
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den > 0 ? num / den : 0;
}

export function analyzePerformance(features: FeatureRecord[], cur: AnalyzerSettings): Insight[] {
  const insights: Insight[] = [];
  const buys = features.filter((f) => f.verdict === "BUY_SMALL" || f.verdict === "BUY_STRONG");
  if (buys.length < MIN_SAMPLE) return insights;

  // 1. Organic: do low-organic BUYs underperform?
  const lowOrg = buys.filter((f) => f.scores.organic < 60);
  const highOrg = buys.filter((f) => f.scores.organic >= 60);
  if (lowOrg.length >= 5 && highOrg.length >= 5 && winRate(lowOrg) + 0.15 < winRate(highOrg)) {
    const to = Math.min(62, cur.minOrganicScore + 7);
    if (to > cur.minOrganicScore) {
      insights.push({
        kind: "raise_min_organic",
        setting: "minOrganicScore",
        from: cur.minOrganicScore,
        to,
        rationale: `Low-organic BUYs win ${(winRate(lowOrg) * 100).toFixed(0)}% vs ${(winRate(highOrg) * 100).toFixed(0)}% — raise min organic ${cur.minOrganicScore}→${to}`,
      });
    }
  }

  // 2. Late entry: do high late-entry-risk BUYs lose?
  const lateHigh = buys.filter((f) => f.scores.lateEntryRisk >= 50);
  const lateLow = buys.filter((f) => f.scores.lateEntryRisk < 50);
  if (lateHigh.length >= 5 && lateLow.length >= 5 && winRate(lateHigh) + 0.15 < winRate(lateLow)) {
    const to = Math.max(50, cur.maxLateEntryRisk - 10);
    if (to < cur.maxLateEntryRisk) {
      insights.push({
        kind: "lower_max_late_entry",
        setting: "maxLateEntryRisk",
        from: cur.maxLateEntryRisk,
        to,
        rationale: `High late-entry-risk BUYs win ${(winRate(lateHigh) * 100).toFixed(0)}% vs ${(winRate(lateLow) * 100).toFixed(0)}% — lower max late-entry ${cur.maxLateEntryRisk}→${to}`,
      });
    }
  }

  // 3. AI hype weakly correlated with winners ⇒ reduce its weight.
  const hypeCorr = corrWithWin(buys, (f) => f.scores.hype);
  if (Math.abs(hypeCorr) < 0.05 && cur.weightHype > 3) {
    insights.push({
      kind: "reduce_hype_weight",
      setting: "weightHype",
      from: cur.weightHype,
      to: cur.weightHype - 2,
      rationale: `LLM hype correlation with winners is weak (${hypeCorr.toFixed(2)}) — reduce hype weight ${cur.weightHype}→${cur.weightHype - 2}`,
    });
  }

  // 4. Smart money strongly correlated ⇒ increase its weight.
  const smartCorr = corrWithWin(buys, (f) => f.scores.smartMoney);
  if (smartCorr > 0.2) {
    insights.push({
      kind: "increase_smart_money_weight",
      setting: "weightSmartMoney",
      from: cur.weightSmartMoney,
      to: cur.weightSmartMoney + 4,
      rationale: `Smart-money score correlates with winners (${smartCorr.toFixed(2)}) — increase its weight ${cur.weightSmartMoney}→${cur.weightSmartMoney + 4}`,
    });
  }

  return insights;
}
