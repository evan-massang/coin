/** Research Cycle 1 — Experiment 1: counterfactual gate replay (READ-ONLY).
 * Feeds the 453 resolved signals through the real backtester under the current
 * gate vs lowered gates. Measures: would lower gates have caught the winners? */
import Database from "better-sqlite3";
import path from "node:path";
import { runBacktest, type HistSignal } from "../../src/learning/backtester.js";
import { LEAGUE_STRATEGIES } from "../../src/replay/strategyLeague.js";
import { emptyScores } from "../../src/types.js";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const rows = db.prepare("SELECT scores, max_gain_pct, max_drawdown_pct FROM signals WHERE max_gain_pct IS NOT NULL").all() as Array<{ scores: string; max_gain_pct: number | null; max_drawdown_pct: number | null }>;
const hist: HistSignal[] = rows.map((r) => ({
  scores: { ...emptyScores(), ...(JSON.parse(r.scores) as Record<string, number>) },
  safetyPass: true, unknownCount: 0,
  maxGainPct: r.max_gain_pct ?? undefined, maxDrawdownPct: r.max_drawdown_pct ?? undefined,
}));

const base = LEAGUE_STRATEGIES[0]!.thresholds; // "balanced" = current production defaults
const variants: Array<[string, typeof base]> = [
  ["baseline (gate 55/72)", base],
  ["gate 45/60", { ...base, minConvictionBuySmall: 45, minConvictionBuyStrong: 60 }],
  ["gate 40/55", { ...base, minConvictionBuySmall: 40, minConvictionBuyStrong: 55 }],
  ["gate 40/55 + organicFloor 40", { ...base, minConvictionBuySmall: 40, minConvictionBuyStrong: 55, minOrganicScore: 40 }],
];

// eslint-disable-next-line no-console
console.log(`# EXPERIMENT 1 — counterfactual gate replay (resolved signals = ${hist.length}, notional = 1 SOL/trade)\n`);
for (const [name, th] of variants) {
  const r = runBacktest(hist, th, 1);
  // eslint-disable-next-line no-console
  console.log(`${name.padEnd(30)} trades=${String(r.trades).padStart(3)} win%=${(r.winRate * 100).toFixed(1).padStart(5)} pnl/notional=${r.totalPnlSol.toFixed(2).padStart(7)} maxDD%=${r.maxDrawdownPct.toFixed(0).padStart(3)} best%=${r.bestTradePct.toFixed(0)} worst%=${r.worstTradePct.toFixed(0)}`);
}
// eslint-disable-next-line no-console
console.log(`\nnote: stored organic is frozen at 45 ("insufficient trade data"), so this isolates the GATE/threshold lever only — it cannot model fixing the upstream scoring.`);
db.close();
