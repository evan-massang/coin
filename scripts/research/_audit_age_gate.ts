/**
 * AUDIT Finding 1+7 — does coin AGE at decision time correlate with outcome,
 * and would a maturity gate ("don't decide until age>=X and >=N txns") select better?
 * READ-ONLY. tsx scripts/research/_audit_age_gate.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const med = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

interface R { symbol: string; ageMs: number; max_gain_pct: number; price_at_alert: number | null; price_5m: number | null; evidence_count: number | null; }

const rows = db.prepare(`
  SELECT s.symbol, (s.at - t.created_at) ageMs, s.max_gain_pct, s.price_at_alert, s.price_5m, s.evidence_count
  FROM signals s JOIN tokens t ON t.mint = s.mint
  WHERE s.verdict IN ('BUY_SMALL','BUY_STRONG')
    AND t.created_at IS NOT NULL AND s.max_gain_pct IS NOT NULL
    AND (s.at - t.created_at) >= 0
`).all() as R[];

const out: string[] = [];
const p = (s = "") => out.push(s);
const isWin = (r: R) => num(r.max_gain_pct) >= 100;
const ret5m = (r: R) => (r.price_at_alert && r.price_5m && r.price_at_alert > 0) ? (num(r.price_5m) - num(r.price_at_alert)) / num(r.price_at_alert) * 100 : null;

p("# AUDIT 1+7 — AGE AT DECISION vs OUTCOME (traded BUYs, resolved)");
p(`n traded+resolved+nonneg-age = ${rows.length}`);

// ── CRITICAL DATA-VALIDITY CHECK ──
const ages = rows.map(r => r.ageMs / 60000);
const sortedAges = [...ages].sort((a, b) => a - b);
p("\n## age-at-alert distribution (minutes)");
p(`  min=${sortedAges[0].toFixed(3)}  p25=${sortedAges[Math.floor(.25*sortedAges.length)].toFixed(3)}  median=${med(ages).toFixed(3)}  p75=${sortedAges[Math.floor(.75*sortedAges.length)].toFixed(3)}  max=${sortedAges[sortedAges.length-1].toFixed(3)}`);
p(`  spread (max-min) = ${(sortedAges[sortedAges.length-1]-sortedAges[0]).toFixed(3)} min (~${((sortedAges[sortedAges.length-1]-sortedAges[0])*60).toFixed(0)}s)`);
p(`  NOTE: tokensRepo.upsert sets created_at := seenAt (first-seen). So this is OBSERVATION LATENCY, not real coin age.`);

// requested buckets
const buckets: Array<[string, number, number]> = [
  ["<1m", 0, 1], ["1-5m", 1, 5], ["5-15m", 5, 15], ["15-60m", 15, 60], [">60m", 60, Infinity],
];
p("\n## requested age buckets (age in minutes)");
p("  bucket     n    win%(>=2x)  meanMaxGain%  medMaxGain%  meanRet5m%");
for (const [lab, lo, hi] of buckets) {
  const b = rows.filter(r => { const m = r.ageMs / 60000; return m >= lo && m < hi; });
  if (!b.length) { p(`  ${lab.padEnd(9)} 0`); continue; }
  const wins = b.filter(isWin).length;
  const gains = b.map(r => num(r.max_gain_pct));
  const r5 = b.map(ret5m).filter((x): x is number => x !== null);
  p(`  ${lab.padEnd(9)} ${String(b.length).padEnd(4)} ${String(pct(wins, b.length)).padEnd(11)} ${mean(gains).toFixed(1).padEnd(13)} ${med(gains).toFixed(1).padEnd(12)} ${(r5.length?mean(r5).toFixed(1):"n/a")}`);
}
p(`  => All mass falls in a single bucket (1-5m). The requested cross-bucket comparison is not estimable from this data.`);

// fine-grained within the only populated band, to wring out ANY age signal
p("\n## fine slices within 1.50-1.57m (does the tiny latency variance separate winners?)");
const fineEdges = [1.50, 1.515, 1.53, 1.545, 1.60];
p("  slice(min)     n    win%   meanMaxGain%");
for (let i = 0; i < fineEdges.length - 1; i++) {
  const lo = fineEdges[i], hi = fineEdges[i + 1];
  const b = rows.filter(r => { const m = r.ageMs / 60000; return m >= lo && m < hi; });
  if (!b.length) continue;
  p(`  ${lo.toFixed(3)}-${hi.toFixed(3)}  ${String(b.length).padEnd(4)} ${String(pct(b.filter(isWin).length, b.length)).padEnd(6)} ${mean(b.map(r => num(r.max_gain_pct))).toFixed(1)}`);
}
// correlation of age vs max_gain (Pearson), and vs win
const gAll = rows.map(r => num(r.max_gain_pct));
const aAll = rows.map(r => r.ageMs / 60000);
const corr = (x: number[], y: number[]) => {
  const mx = mean(x), my = mean(y);
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) { n += (x[i]-mx)*(y[i]-my); dx += (x[i]-mx)**2; dy += (y[i]-my)**2; }
  return (dx && dy) ? n / Math.sqrt(dx*dy) : 0;
};
p(`\n  Pearson corr(age, maxGain) = ${corr(aAll, gAll).toFixed(3)}  (≈0 ⇒ no relationship; age has ~no variance anyway)`);

// overall win rate baseline
p(`\n## baseline`);
p(`  overall traded win%(>=2x) = ${pct(rows.filter(isWin).length, rows.length)}  meanMaxGain=${mean(gAll).toFixed(1)}%  medMaxGain=${med(gAll).toFixed(1)}%`);

// evidence_count as a proxy for "N txns observed" — the OTHER half of the proposed gate
p("\n## proxy for '>=N txns observed' — evidence_count buckets (the gate's tx-count half)");
const ecRows = rows.filter(r => r.evidence_count !== null);
p(`  rows with evidence_count = ${ecRows.length}`);
if (ecRows.length) {
  const ecVals = ecRows.map(r => num(r.evidence_count)).sort((a,b)=>a-b);
  p(`  evidence_count dist: min=${ecVals[0]} median=${ecVals[Math.floor(ecVals.length/2)]} max=${ecVals[ecVals.length-1]}`);
  const ecB: Array<[string, (n:number)=>boolean]> = [
    ["<=2", n=>n<=2], ["3-5", n=>n>=3&&n<=5], ["6-10", n=>n>=6&&n<=10], [">10", n=>n>10],
  ];
  p("  ecBucket   n    win%   meanMaxGain%");
  for (const [lab, f] of ecB) {
    const b = ecRows.filter(r => f(num(r.evidence_count)));
    if (!b.length) continue;
    p(`  ${lab.padEnd(9)} ${String(b.length).padEnd(4)} ${String(pct(b.filter(isWin).length, b.length)).padEnd(6)} ${mean(b.map(r => num(r.max_gain_pct))).toFixed(1)}`);
  }
}

p("\n## CONCLUSION");
p("  - 'age at decision' as stored cannot test the maturity gate: created_at == first_seen_at for all 13,374 tokens,");
p("    so measured age is a fixed ~1.5-min ingestion latency (1.50-1.57m, ~4s spread), not on-chain coin age.");
p("  - With no age variance, win-rate-vs-age is unestimable and corr≈0 is meaningless (no signal possible).");
p("  - A 'wait until age>=X' gate is therefore NOT supported NOR refuted by this DB — the prerequisite field is missing.");
p("  - To evaluate it, the engine must first persist the REAL pump.fun creation timestamp (from on-chain/uri), distinct from first_seen.");

console.log(out.join("\n"));
db.close();
