/**
 * READ-ONLY probe: is the late-entry "don't chase" guard actually firing live?
 * And how big is the entry-timing loser tail?
 *   npx tsx scripts/research/_audit_lateguard.ts
 */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), {
  readonly: true,
  fileMustExist: true,
});

type Row = {
  id: number;
  verdict: string;
  conviction: number | null;
  scores: string | null;
  price_at_alert: number | null;
  price_5m: number | null;
  price_15m: number | null;
  max_gain_pct: number | null;
  max_drawdown_pct: number | null;
};

const all = db.prepare(`SELECT id, verdict, conviction, scores, price_at_alert, price_5m, price_15m, max_gain_pct, max_drawdown_pct FROM signals`).all() as Row[];

function lateRisk(r: Row): number | null {
  if (!r.scores) return null;
  try {
    const s = JSON.parse(r.scores) as { lateEntryRisk?: number };
    return typeof s.lateEntryRisk === "number" ? s.lateEntryRisk : null;
  } catch {
    return null;
  }
}

const byVerdict: Record<string, number> = {};
for (const r of all) byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;

const withRisk = all.map((r) => lateRisk(r)).filter((x): x is number => x != null);
const nonzeroRisk = withRisk.filter((x) => x > 0);
const fireRisk = withRisk.filter((x) => x > 70); // would force TOO_LATE at default maxLateEntryRisk=70
const buys = all.filter((r) => r.verdict === "BUY_SMALL" || r.verdict === "BUY_STRONG");
const buyRisks = buys.map((r) => lateRisk(r)).filter((x): x is number => x != null);
const buyNonzero = buyRisks.filter((x) => x > 0);

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const pct = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

console.log("=== VERDICT BREAKDOWN (all signals) ===");
console.log(`total signals: ${all.length}`);
for (const [v, n] of Object.entries(byVerdict).sort((a, b) => b[1] - a[1])) console.log(`  ${v}: ${n}`);
console.log(`TOO_LATE fired: ${byVerdict["TOO_LATE"] ?? 0}  (if ~0, the late-entry guard never triggers)`);

console.log("\n=== lateEntryRisk score distribution ===");
console.log(`signals with a lateEntryRisk score: ${withRisk.length}`);
console.log(`  == 0: ${withRisk.length - nonzeroRisk.length}  ( ${(((withRisk.length - nonzeroRisk.length) / Math.max(1, withRisk.length)) * 100).toFixed(1)}% )`);
console.log(`  >  0: ${nonzeroRisk.length}   >70 (would fire): ${fireRisk.length}`);
console.log(`  mean ${mean(withRisk).toFixed(2)}  median ${median(withRisk).toFixed(2)}  p90 ${pct(withRisk, 90).toFixed(2)}  max ${Math.max(0, ...withRisk).toFixed(2)}`);
console.log(`among BUYs (${buys.length}): nonzero lateEntryRisk ${buyNonzero.length}  mean ${mean(buyRisks).toFixed(2)}  max ${buyRisks.length ? Math.max(...buyRisks).toFixed(2) : "n/a"}`);

console.log("\n=== ENTRY-TIMING LOSER TAIL (traded BUYs) ===");
const tail = buys.filter((r) => r.price_at_alert && r.price_at_alert > 0 && r.price_5m != null);
const ret5 = tail.map((r) => ((r.price_5m! - r.price_at_alert!) / r.price_at_alert!) * 100);
console.log(`traded BUYs with price_at_alert & price_5m: ${tail.length}`);
if (ret5.length) {
  console.log(`ret@5m  mean ${mean(ret5).toFixed(1)}%  median ${median(ret5).toFixed(1)}%  p10 ${pct(ret5, 10).toFixed(1)}%  p90 ${pct(ret5, 90).toFixed(1)}%`);
  console.log(`  negative@5m: ${ret5.filter((x) => x < 0).length}/${ret5.length} (${((ret5.filter((x) => x < 0).length / ret5.length) * 100).toFixed(1)}%)`);
  console.log(`  <= -20%@5m: ${ret5.filter((x) => x <= -20).length}   <= -40%@5m: ${ret5.filter((x) => x <= -40).length}`);
}
const resolved = buys.filter((r) => r.max_gain_pct != null);
const winners = resolved.filter((r) => (r.max_gain_pct ?? 0) >= 100);
console.log(`resolved BUYs: ${resolved.length}  2x-winners(max_gain>=100): ${winners.length} (${resolved.length ? ((winners.length / resolved.length) * 100).toFixed(1) : "0"}%)`);

console.log("\n=== conviction spread on BUYs (calibration sanity) ===");
const convs = buys.map((r) => r.conviction).filter((x): x is number => x != null);
if (convs.length) console.log(`conviction  min ${Math.min(...convs)}  median ${median(convs)}  mean ${mean(convs).toFixed(1)}  max ${Math.max(...convs)}`);

db.close();
