/**
 * Cycle 5 experiment (READ-ONLY): momentum is the only strong winner/loser
 * discriminator (+9.5 lift). Does adding a momentum FLOOR on top of the
 * UNCHANGED conviction gate (55/72) improve backtested PnL? We never lower the
 * gate (replay proved gate 40 => buy-everything => -136 SOL); we only ADD a
 * selection constraint and measure trades / win% / pnl-per-notional.
 *   tsx scripts/research/cycle5-momentum-floor.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
import { runBacktest, type HistSignal } from "../../src/learning/backtester.js";
import { LEAGUE_STRATEGIES } from "../../src/replay/strategyLeague.js";
import { emptyScores } from "../../src/types.js";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const J = (v: unknown): Record<string, number> => { try { return JSON.parse(String(v)); } catch { return {}; } };

const rows = db.prepare(
  "SELECT verdict, conviction, scores, max_gain_pct, max_drawdown_pct, real_pnl_sol FROM signals WHERE max_gain_pct IS NOT NULL",
).all() as Array<Record<string, unknown>>;
const isWin = (r: Record<string, unknown>) => num(r.max_gain_pct) >= 100 || num(r.real_pnl_sol) > 0;

const out: string[] = []; const p = (s = "") => out.push(s);
const pct = (xs: number[], q: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]!; };

const winners = rows.filter(isWin), losers = rows.filter((r) => !isWin(r));
const momOf = (r: Record<string, unknown>) => num(J(r.scores).momentum);
const wMom = winners.map(momOf), lMom = losers.map(momOf);

p(`# CYCLE 5 — MOMENTUM FLOOR EXPERIMENT (resolved=${rows.length}, winners=${winners.length}, losers=${losers.length})`);
p(`momentum distribution (p25/p50/p75):`);
p(`  winners: ${pct(wMom, 0.25)} / ${pct(wMom, 0.5)} / ${pct(wMom, 0.75)}   mean ${(wMom.reduce((a, b) => a + b, 0) / (wMom.length || 1)).toFixed(1)}`);
p(`  losers : ${pct(lMom, 0.25)} / ${pct(lMom, 0.5)} / ${pct(lMom, 0.75)}   mean ${(lMom.reduce((a, b) => a + b, 0) / (lMom.length || 1)).toFixed(1)}`);
p("");

const toHist = (r: Record<string, unknown>): HistSignal => ({
  scores: { ...emptyScores(), ...J(r.scores) },
  safetyPass: true, unknownCount: 0,
  maxGainPct: num(r.max_gain_pct), maxDrawdownPct: num(r.max_drawdown_pct),
});
const gate = LEAGUE_STRATEGIES[0]!.thresholds;

p(`backtest at UNCHANGED gate 55/72, with an added momentum>=floor pre-filter:`);
p(`floor | trades | win%  | pnl/notional | winners-kept`);
for (const floor of [0, 20, 30, 40, 50, 60, 70]) {
  const kept = rows.filter((r) => momOf(r) >= floor);
  const winnersKept = kept.filter(isWin).length;
  const res = runBacktest(kept.map(toHist), gate, 1);
  p(`${String(floor).padStart(5)} | ${String(res.trades).padStart(6)} | ${(res.winRate * 100).toFixed(1).padStart(5)} | ${res.totalPnlSol.toFixed(2).padStart(12)} | ${winnersKept}/${winners.length}`);
}
p("");
p(`note: pnl uses the existing ladder-capture model (peak-based; ignores stop-loss).`);
p(`a floor that turns pnl positive while keeping trades>0 and most winners is the candidate.`);

// eslint-disable-next-line no-console
console.log(out.join("\n"));
db.close();
