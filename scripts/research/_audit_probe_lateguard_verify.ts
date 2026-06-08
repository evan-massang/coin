import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const totalSignals = (db.prepare("SELECT COUNT(*) c FROM signals").get() as any).c;
console.log("total signals:", totalSignals);

const tooLate = (db.prepare("SELECT COUNT(*) c FROM signals WHERE verdict='TOO_LATE'").get() as any).c;
console.log("verdict=TOO_LATE:", tooLate);

// distinct verdicts
const verdicts = db.prepare("SELECT verdict, COUNT(*) c FROM signals GROUP BY verdict ORDER BY c DESC").all();
console.log("verdicts:", JSON.stringify(verdicts));

// BUY signals: pull lateEntryRisk from scores JSON
const buys = db.prepare("SELECT id, verdict, scores, reasons FROM signals WHERE verdict LIKE 'BUY%'").all() as any[];
console.log("total BUY signals:", buys.length);

function lateRiskOf(row: any): number | null {
  try {
    const s = JSON.parse(row.scores);
    const v = s?.lateEntryRisk;
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

const risks = buys.map(lateRiskOf).filter((x): x is number => x !== null).sort((a, b) => a - b);
function pct(p: number) {
  if (!risks.length) return NaN;
  const idx = Math.min(risks.length - 1, Math.floor((p / 100) * risks.length));
  return risks[idx];
}
const mean = risks.reduce((a, b) => a + b, 0) / (risks.length || 1);
console.log(
  `lateEntryRisk on BUYs: n=${risks.length} p0=${pct(0)} p25=${pct(25)} p50=${pct(50)} p75=${pct(75)} p90=${pct(90)} p99=${pct(99)} p100=${risks[risks.length-1]} mean=${mean.toFixed(2)}`
);

// exact value buckets
const buckets: Record<string, number> = {};
for (const r of risks) buckets[String(r)] = (buckets[String(r)] ?? 0) + 1;
console.log("exact value counts on BUYs:", JSON.stringify(buckets));

// reasons containing 'buyer velocity declining'
let declining = 0;
let decliningAnd20 = 0;
for (const row of buys) {
  let reasons: string[] = [];
  try { reasons = JSON.parse(row.reasons) ?? []; } catch {}
  const hasDecl = reasons.some((r) => typeof r === "string" && r.toLowerCase().includes("buyer velocity declining"));
  if (hasDecl) {
    declining++;
    if (lateRiskOf(row) === 20) decliningAnd20++;
  }
}
console.log(`BUYs with reason 'buyer velocity declining': ${declining}/${buys.length} (${((declining/buys.length)*100).toFixed(1)}%)`);
console.log(`  of those, lateEntryRisk==20: ${decliningAnd20}`);

db.close();
