/** READ-ONLY: did the momentum RESHAPE pivot change WHAT the engine buys?
 * New BUYs should now have LOW m5 run-up (flat/dip) instead of chasing spikes.
 *   npx tsx scripts/research/_audit_pivotverify.ts */
import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const CUTOFF = 1780835322085; // iter-4 (pivot) engine boot

function m5sOf(where: string, params: any[]): number[] {
  const rows = db.prepare(`SELECT scores FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND ${where}`).all(...params) as { scores: string | null }[];
  const out: number[] = [];
  for (const r of rows) { try { const s = JSON.parse(r.scores ?? "{}"); if (typeof s.recentM5Pct === "number") out.push(s.recentM5Pct); } catch { /* */ } }
  return out;
}
const stat = (a: number[]) => { if (!a.length) return "n=0"; const s = [...a].sort((x, y) => x - y); const mean = a.reduce((p, x) => p + x, 0) / a.length; const inSweet = a.filter((x) => x >= -25 && x <= 12).length; const chase = a.filter((x) => x > 30).length; return `n=${a.length} mean=${mean.toFixed(0)}% median=${s[Math.floor(s.length / 2)].toFixed(0)}% | in sweet-spot[-25,12]=${((inSweet / a.length) * 100).toFixed(0)}% chasing(>30%)=${((chase / a.length) * 100).toFixed(0)}%`;
};
console.log("BUY entry m5 run-up — pivot should shift it DOWN into the sweet-spot:");
console.log(`  PRE-pivot  BUYs: ${stat(m5sOf("at <= ?", [CUTOFF]))}`);
console.log(`  POST-pivot BUYs: ${stat(m5sOf("at > ?", [CUTOFF]))}`);
db.close();
