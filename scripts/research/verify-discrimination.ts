/**
 * Verification harness (READ-ONLY): measures whether a scoring change restores
 * DISCRIMINATION — i.e. winners separate from losers — rather than just inflating
 * conviction. Run after a fix accumulates new resolved signals, or against a
 * provided JSON export. Compares winner vs loser facet lift + conviction range +
 * what a backtest would do at the UNCHANGED gate (must NOT buy everything).
 *   tsx scripts/research/verify-discrimination.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
import { runBacktest, type HistSignal } from "../../src/learning/backtester.js";
import { LEAGUE_STRATEGIES } from "../../src/replay/strategyLeague.js";
import { emptyScores } from "../../src/types.js";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const J = (v: unknown): Record<string, number> => { try { return JSON.parse(String(v)); } catch { return {}; } };

// Only signals scored AFTER a cutoff (so we can isolate post-fix behaviour). Pass
// a unix-ms cutoff as argv[2]; default 0 = all history.
const cutoff = Number(process.argv[2] ?? 0);
const rows = db.prepare("SELECT verdict, conviction, scores, max_gain_pct, max_drawdown_pct, real_pnl_sol FROM signals WHERE max_gain_pct IS NOT NULL AND at >= ?").all(cutoff) as Array<Record<string, unknown>>;
const isWin = (r: Record<string, unknown>) => num(r.max_gain_pct) >= 100 || num(r.real_pnl_sol) > 0;

const out: string[] = []; const p = (s = "") => out.push(s);
p(`# DISCRIMINATION CHECK (resolved signals since ${cutoff || "始"} = ${rows.length})`);
const winners = rows.filter(isWin), losers = rows.filter((r) => !isWin(r));
p(`winners=${winners.length} losers=${losers.length}`);

// 1. conviction range (was: maxed at 47, single bin)
const convs = rows.map((r) => num(r.conviction));
p(`conviction: min=${Math.min(...convs, 0)} max=${Math.max(...convs, 0)} >=55=${convs.filter((c) => c >= 55).length}`);

// 2. facet lift (was: ~0 for everything = no discrimination)
const facets = ["organic", "momentum", "graduation", "devReputation", "smartMoney", "social", "hype", "lateEntryRisk"];
const avg = (set: Array<Record<string, unknown>>, f: string) => set.length ? set.reduce((a, r) => a + num(J(r.scores)[f]), 0) / set.length : 0;
if (winners.length >= 3 && losers.length >= 3) {
  p("facet lift (winner-loser; >0 = discriminative, ~0 = noise):");
  facets.map((f) => ({ f, lift: avg(winners, f) - avg(losers, f) })).sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift))
    .forEach((x) => p(`  ${x.f.padEnd(14)} ${(x.lift >= 0 ? "+" : "") + x.lift.toFixed(1)}`));
} else p("  (need >=3 winners and losers — let the engine accumulate)");

// 3. guardrail: at the UNCHANGED gate, does it still avoid buying everything?
const hist: HistSignal[] = rows.map((r) => ({ scores: { ...emptyScores(), ...J(r.scores) }, safetyPass: true, unknownCount: 0, maxGainPct: num(r.max_gain_pct), maxDrawdownPct: num(r.max_drawdown_pct) }));
const r = runBacktest(hist, LEAGUE_STRATEGIES[0]!.thresholds, 1);
p(`\nat current gate 55/72: trades=${r.trades}/${hist.length} win%=${(r.winRate * 100).toFixed(1)} pnl/notional=${r.totalPnlSol.toFixed(2)}`);
p(r.trades === 0 ? "  (still 0 — fix not yet effective OR no qualifying tokens in window)" : r.trades < hist.length * 0.5 ? "  OK: selective (does not buy everything)" : "  ⚠ buys >50% — discrimination NOT restored; do not deploy");

// eslint-disable-next-line no-console
console.log(out.join("\n"));
db.close();
