/**
 * Cycle 5 (READ-ONLY): quantify the DEPLOYED stop-loss on real traded history
 * using the faithful, drawdown-aware exit model (ordering bounds). Compares the
 * mean per-trade PnL with stop-loss OFF vs 0.45 vs 0.35.
 *   tsx scripts/research/cycle5-stoploss.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
import { backtestExits, type HistSignal } from "../../src/learning/backtester.js";
import { LEAGUE_STRATEGIES } from "../../src/replay/strategyLeague.js";
import { emptyScores } from "../../src/types.js";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const J = (v: unknown): Record<string, number> => { try { return JSON.parse(String(v)); } catch { return {}; } };

const rows = db.prepare(
  "SELECT scores, max_gain_pct, max_drawdown_pct FROM signals WHERE max_gain_pct IS NOT NULL",
).all() as Array<Record<string, unknown>>;
const hist: HistSignal[] = rows.map((r) => ({
  scores: { ...emptyScores(), ...J(r.scores) },
  safetyPass: true, unknownCount: 0,
  maxGainPct: num(r.max_gain_pct), maxDrawdownPct: num(r.max_drawdown_pct),
}));
const gate = LEAGUE_STRATEGIES[0]!.thresholds;

const out: string[] = []; const p = (s = "") => out.push(s);
p(`# CYCLE 5 — STOP-LOSS BENEFIT (faithful model; resolved=${hist.length}, gate 55/72)`);
p(`stopLoss | trades | win% | mean PnL/trade  (optimistic … pessimistic)`);
for (const sl of [0, 0.45, 0.35, 0.30]) {
  const r = backtestExits(hist, gate, { stopLossPct: sl });
  p(`  ${sl.toFixed(2)}   | ${String(r.trades).padStart(5)} | ${(r.winRate * 100).toFixed(1).padStart(4)} | ${(r.pnlOptimistic * 100).toFixed(1).padStart(7)}% … ${(r.pnlPessimistic * 100).toFixed(1).padStart(7)}%`);
}
p("");
p(`optimistic = peak-first ordering (winner ran then gave back); pessimistic = trough-first`);
p(`(stop fired before any run). Truth per-trade sits between; losers ~pessimistic, winners ~optimistic.`);

// eslint-disable-next-line no-console
console.log(out.join("\n"));
db.close();
