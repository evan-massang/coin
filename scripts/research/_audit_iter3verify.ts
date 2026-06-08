/** READ-ONLY: clean verification of the iter-3 momentum ceiling, signals AFTER restart.
 *   npx tsx scripts/research/_audit_iter3verify.ts */
import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const CUTOFF = 1780827153594; // fresh 38-SOL paper wallet reset (clean iter-3 slate)

const sigs = db.prepare(`SELECT verdict, conviction, scores, flags FROM signals WHERE at > ?`).all(CUTOFF) as { verdict: string; conviction: number; scores: string | null; flags: string | null }[];
const by: Record<string, number> = {};
let buyMaxMom = 0, buyMomGE70 = 0, chaseFlag = 0;
const buys: number[] = [];
for (const r of sigs) {
  by[r.verdict] = (by[r.verdict] ?? 0) + 1;
  let s: any = {}, f: string[] = [];
  try { s = JSON.parse(r.scores ?? "{}"); } catch { /* */ }
  try { f = JSON.parse(r.flags ?? "[]"); } catch { /* */ }
  if (f.includes("high-momentum-chase")) chaseFlag++;
  if (r.verdict === "BUY_SMALL" || r.verdict === "BUY_STRONG") {
    const m = s.momentum ?? 0; buys.push(m); buyMaxMom = Math.max(buyMaxMom, m); if (m >= 70) buyMomGE70++;
  }
}
console.log(`signals since iter-3 boot: ${sigs.length}`);
console.log(`  verdicts: ${Object.entries(by).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`  BUYs: ${buys.length}  max momentum among BUYs: ${buyMaxMom}  BUYs with momentum>=70: ${buyMomGE70}  (ceiling works ⇔ 0)`);
console.log(`  'high-momentum-chase' demotions (would-be BUYs held to WATCH): ${chaseFlag}`);

// CLEAN cohort: only positions ENTERED under iter-3 (the real A/B vs the −0.0135 baseline).
const cohort = db.prepare(`SELECT realized_pnl_usd AS p, closed_at_ms FROM paper_positions WHERE entry_at_ms > ?`).all(CUTOFF) as { p: number | null; closed_at_ms: number | null }[];
const closed = cohort.filter((c) => c.closed_at_ms != null);
console.log(`iter-3 COHORT (positions ENTERED after boot): ${cohort.length} entered, ${closed.length} closed, ${cohort.length - closed.length} open`);
if (closed.length) {
  const totUsd = closed.reduce((s, x) => s + (x.p || 0), 0);
  const wins = closed.filter((x) => (x.p || 0) > 0).length;
  console.log(`  realized: total $${totUsd.toFixed(2)} (~${(totUsd / 150).toFixed(3)} SOL)  mean/pos $${(totUsd / closed.length).toFixed(3)} (~${(totUsd / 150 / closed.length).toFixed(4)} SOL)  win% ${((wins / closed.length) * 100).toFixed(1)}`);
  console.log(`  baseline mean/sell was -0.0135 SOL — this cohort needs >=~50 closed to be a real read`);
} else console.log(`  (no iter-3 positions closed yet — need more time)`);
db.close();
