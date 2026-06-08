/**
 * READ-ONLY: does ENTRY RUN-UP (recorded recentM5Pct) predict REALIZED outcome?
 * This is the calibration for flipping the late-entry guard from shadow to enforce.
 *   npx tsx scripts/research/_audit_runup_realized.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
import { exitOutcomeBounds, type ExitModel } from "../../src/learning/backtester.js";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const SHIP: ExitModel = { ladder: [[1.4, 0.3], [1.8, 0.3], [2.5, 0.2], [5, 0.1]].map(([multiple, sellPct]) => ({ multiple, sellPct })), trailingStopPct: 0.3, stopLossPct: 0.4, trailingActivateMultiple: 1.25 };

type Row = { verdict: string; scores: string | null; price_at_alert: number | null; price_5m: number | null; max_gain_pct: number | null; max_drawdown_pct: number | null };
const rows = db.prepare(`SELECT verdict, scores, price_at_alert, price_5m, max_gain_pct, max_drawdown_pct FROM signals WHERE max_gain_pct IS NOT NULL AND max_drawdown_pct IS NOT NULL`).all() as Row[];
db.close();

type T = { m5: number; verdict: string; realized: number; ret5: number | null; peak: number };
const data: T[] = [];
for (const r of rows) {
  let s: any = {}; try { s = JSON.parse(r.scores ?? "{}"); } catch { /* */ }
  if (typeof s.recentM5Pct !== "number") continue;
  const b = exitOutcomeBounds(r.max_gain_pct ?? 0, r.max_drawdown_pct ?? 0, SHIP);
  const ret5 = r.price_at_alert && r.price_at_alert > 0 && r.price_5m != null ? ((r.price_5m - r.price_at_alert) / r.price_at_alert) * 100 : null;
  data.push({ m5: s.recentM5Pct, verdict: r.verdict, realized: (b.optimistic + b.pessimistic) / 2 - 1, ret5, peak: r.max_gain_pct ?? 0 });
}
console.log(`signals with recentM5Pct AND a resolved path: ${data.length}`);
const buys = data.filter((d) => d.verdict === "BUY_SMALL" || d.verdict === "BUY_STRONG");
console.log(`of which BUYs: ${buys.length}\n`);

function report(label: string, rows: T[]) {
  console.log(`── ${label} (n=${rows.length}) ──`);
  const buckets: [string, (m: number) => boolean][] = [
    ["m5 <= -30   ", (m) => m <= -30], ["m5 -30..0   ", (m) => m > -30 && m <= 0], ["m5 0..25    ", (m) => m > 0 && m <= 25],
    ["m5 25..75   ", (m) => m > 25 && m <= 75], ["m5 75..200  ", (m) => m > 75 && m <= 200], ["m5 200+     ", (m) => m > 200],
  ];
  for (const [name, f] of buckets) {
    const g = rows.filter((d) => f(d.m5));
    if (!g.length) { console.log(`   ${name} n=0`); continue; }
    const realized = g.reduce((s, x) => s + x.realized, 0) / g.length;
    const r5 = g.filter((x) => x.ret5 != null); const meanR5 = r5.length ? r5.reduce((s, x) => s + (x.ret5 as number), 0) / r5.length : NaN;
    const win2x = g.filter((x) => x.peak >= 100).length;
    console.log(`   ${name} n=${String(g.length).padStart(4)}  realizedMid=${(realized * 100).toFixed(1).padStart(6)}%  ret5m=${isNaN(meanR5) ? "  n/a" : meanR5.toFixed(1).padStart(6)}%  2x=${((win2x / g.length) * 100).toFixed(1)}%`);
  }
}
report("ALL resolved w/ run-up", data);
console.log("");
report("BUYs only", buys);
