/** READ-ONLY: is the dip-buy rule feasible/positive on recorded data?
 * Also: do newborns even have a separate h1 vs m5 (needed for "uptrend + pullback")?
 *   npx tsx scripts/research/_audit_diprule.ts */
import Database from "better-sqlite3";
import path from "node:path";
import { exitOutcomeBounds, type ExitModel } from "../../src/learning/backtester.js";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const SHIP: ExitModel = { ladder: [[1.4, 0.3], [1.8, 0.3], [2.5, 0.2], [5, 0.1]].map(([multiple, sellPct]) => ({ multiple, sellPct })), trailingStopPct: 0.3, stopLossPct: 0.4, trailingActivateMultiple: 1.25 };
const rows = db.prepare(`SELECT scores, max_gain_pct, max_drawdown_pct FROM signals WHERE max_gain_pct IS NOT NULL AND max_drawdown_pct IS NOT NULL`).all() as { scores: string | null; max_gain_pct: number; max_drawdown_pct: number }[];
db.close();

let nBoth = 0, nSame = 0, nDiff = 0;
const all: { m5: number; h1: number; realized: number }[] = [];
for (const r of rows) {
  let s: any = {}; try { s = JSON.parse(r.scores ?? "{}"); } catch { /* */ }
  if (typeof s.recentM5Pct !== "number" || typeof s.recentH1Pct !== "number") continue;
  nBoth++;
  if (Math.abs(s.recentM5Pct - s.recentH1Pct) < 1) nSame++; else nDiff++;
  all.push({ m5: s.recentM5Pct, h1: s.recentH1Pct, realized: (exitOutcomeBounds(r.max_gain_pct, r.max_drawdown_pct, SHIP).optimistic + exitOutcomeBounds(r.max_gain_pct, r.max_drawdown_pct, SHIP).pessimistic) / 2 - 1 });
}
console.log(`signals with both m5 & h1: ${nBoth}  |  m5==h1 (newborn, no separate window): ${nSame} (${((nSame / nBoth) * 100).toFixed(1)}%)  m5≠h1: ${nDiff}`);

const agg = (rs: typeof all, label: string) => {
  if (!rs.length) { console.log(`  ${label}: n=0`); return; }
  const mid = rs.reduce((s, x) => s + x.realized, 0) / rs.length;
  console.log(`  ${label}: n=${rs.length}  realizedMid=${(mid * 100).toFixed(1)}%`);
};
console.log("\nCandidate entry rules (realized under SHIP exit):");
agg(all, "ALL with run-up");
agg(all.filter((x) => x.m5 >= -25 && x.m5 <= -3), "DIP m5∈[-25,-3]");
agg(all.filter((x) => x.h1 >= 30 && x.m5 >= -25 && x.m5 <= -3), "DIP+uptrend h1≥30 & m5∈[-25,-3]");
agg(all.filter((x) => Math.abs(x.m5) <= 5), "FLAT |m5|≤5 (early-entry zone)");
agg(all.filter((x) => x.m5 > -10 && x.m5 <= 10), "NEAR-FLAT m5∈(-10,10]");
agg(all.filter((x) => x.m5 <= -3 && x.m5 >= -30), "PULLBACK m5∈[-30,-3]");
