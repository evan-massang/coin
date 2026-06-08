/**
 * READ-ONLY: does CHASING momentum + a RIDE-THE-WINNER exit beat buying flat?
 * Tests the user's thesis: meme profit = catch pumps + let winners run (asymmetric).
 * Compares exit models on the HIGH-run-up cohort vs the FLAT cohort.
 *   npx tsx scripts/research/_audit_moonshot.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
import { exitOutcomeBounds, type ExitModel } from "../../src/learning/backtester.js";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const rows = db.prepare(`SELECT scores, max_gain_pct, max_drawdown_pct FROM signals WHERE max_gain_pct IS NOT NULL AND max_drawdown_pct IS NOT NULL`).all() as { scores: string | null; max_gain_pct: number; max_drawdown_pct: number }[];
db.close();

const L = (r: [number, number][]) => r.map(([multiple, sellPct]) => ({ multiple, sellPct }));
const EXITS: { name: string; m: ExitModel }[] = [
  { name: "SHIP early-harvest [1.4/1.8/2.5/5] stop40", m: { ladder: L([[1.4, 0.3], [1.8, 0.3], [2.5, 0.2], [5, 0.1]]), trailingStopPct: 0.3, stopLossPct: 0.4, trailingActivateMultiple: 1.25 } },
  { name: "RIDE [3/10] trail50 stop50            ", m: { ladder: L([[3, 0.3], [10, 0.3]]), trailingStopPct: 0.5, stopLossPct: 0.5, trailingActivateMultiple: 2 } },
  { name: "RIDE-WIDE [5/20] trail60 stop60       ", m: { ladder: L([[5, 0.25], [20, 0.25]]), trailingStopPct: 0.6, stopLossPct: 0.6, trailingActivateMultiple: 3 } },
  { name: "MOON [10] trail70 no-stop             ", m: { ladder: L([[10, 0.5]]), trailingStopPct: 0.7, stopLossPct: 0, trailingActivateMultiple: 3 } },
  { name: "TRAIL-ONLY trail45 stop50             ", m: { ladder: L([]), trailingStopPct: 0.45, stopLossPct: 0.5, trailingActivateMultiple: 1.5 } },
];

type T = { m5: number; mg: number; dd: number };
const all: T[] = [];
for (const r of rows) { let s: any = {}; try { s = JSON.parse(r.scores ?? "{}"); } catch { /* */ } if (typeof s.recentM5Pct !== "number") continue; all.push({ m5: s.recentM5Pct, mg: r.max_gain_pct, dd: r.max_drawdown_pct }); }

function evalCohort(label: string, rows: T[]) {
  console.log(`\n── ${label} (n=${rows.length}) ──`);
  for (const e of EXITS) {
    let opt = 0, pess = 0;
    for (const t of rows) { const b = exitOutcomeBounds(t.mg, t.dd, e.m); opt += b.optimistic - 1; pess += b.pessimistic - 1; }
    const n = rows.length || 1;
    console.log(`   ${e.name}  opt=${((opt / n) * 100).toFixed(1).padStart(7)}%  pess=${((pess / n) * 100).toFixed(1).padStart(7)}%  mid=${(((opt + pess) / (2 * n)) * 100).toFixed(1).padStart(7)}%`);
  }
}
evalCohort("PUMPING m5>30 (chase cohort)", all.filter((t) => t.m5 > 30));
evalCohort("HIGH-RUN m5>100", all.filter((t) => t.m5 > 100));
evalCohort("FLAT/DIP m5<=12", all.filter((t) => t.m5 <= 12));
evalCohort("ALL", all);
