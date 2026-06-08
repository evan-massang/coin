/**
 * AUDIT Finding 3+4 (DATA part): conviction distribution across ALL signals and
 * across traded BUYs. Histogram in 10-pt buckets; min/max/median; % at exactly 59.
 * Confirm/deny "everything is 59". READ-ONLY.
 *   npx tsx scripts/research/_audit_conviction_dist.ts
 */
import Database from "better-sqlite3";
import path from "node:path";

const dbPath = path.resolve("data/sniper.sqlite");
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const out: string[] = [];
const p = (s = "") => out.push(s);

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function describe(label: string, vals: number[]): void {
  p(`\n=== ${label} (n=${vals.length}) ===`);
  if (vals.length === 0) { p("  (no rows)"); return; }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const med = median(vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const at59 = vals.filter((v) => v === 59).length;
  p(`  min=${min}  max=${max}  median=${med}  mean=${mean.toFixed(1)}`);
  p(`  % exactly 59: ${((at59 / vals.length) * 100).toFixed(1)}%  (${at59}/${vals.length})`);

  // 10-pt buckets 0-9,10-19,...,90-100
  const buckets = new Array(10).fill(0);
  for (const v of vals) {
    const b = Math.min(9, Math.floor(v / 10));
    buckets[b]++;
  }
  p("  histogram (10-pt buckets):");
  const maxBar = Math.max(...buckets);
  for (let i = 0; i < 10; i++) {
    const lo = i * 10;
    const hi = i === 9 ? 100 : i * 10 + 9;
    const cnt = buckets[i];
    const barLen = maxBar ? Math.round((cnt / maxBar) * 40) : 0;
    const pctV = ((cnt / vals.length) * 100).toFixed(1);
    p(`    ${String(lo).padStart(3)}-${String(hi).padStart(3)}: ${String(cnt).padStart(6)} (${pctV.padStart(5)}%) ${"#".repeat(barLen)}`);
  }

  // exact-value frequency table (top values) — to see if "everything is 59" or a few discrete pegs
  const freq = new Map<number, number>();
  for (const v of vals) freq.set(v, (freq.get(v) ?? 0) + 1);
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  p("  top exact conviction values:");
  for (const [val, cnt] of top) {
    p(`    conviction=${String(val).padStart(3)}: ${String(cnt).padStart(6)} (${((cnt / vals.length) * 100).toFixed(1)}%)`);
  }
}

interface Row { verdict: string; conviction: number; caps: string | null; max_gain_pct: number | null; }
const rows = db.prepare("SELECT verdict, conviction, caps, max_gain_pct FROM signals").all() as Row[];

p(`TOTAL signals: ${rows.length}`);

// ALL signals
describe("ALL signals", rows.map((r) => r.conviction));

// Traded BUYs only
const buys = rows.filter((r) => r.verdict === "BUY_SMALL" || r.verdict === "BUY_STRONG");
describe("Traded BUYs (BUY_SMALL|BUY_STRONG)", buys.map((r) => r.conviction));

// Per-verdict conviction median + %@59 (context)
p("\n=== conviction by verdict ===");
const byV = new Map<string, number[]>();
for (const r of rows) {
  if (!byV.has(r.verdict)) byV.set(r.verdict, []);
  byV.get(r.verdict)!.push(r.conviction);
}
for (const [v, vals] of [...byV.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const at59 = vals.filter((x) => x === 59).length;
  p(`  ${v.padEnd(12)} n=${String(vals.length).padStart(6)}  median=${median(vals)}  min=${Math.min(...vals)} max=${Math.max(...vals)}  %@59=${((at59 / vals.length) * 100).toFixed(1)}%`);
}

// WHY 59? cap-string frequency among BUYs (which cap is binding the conviction)
p("\n=== caps[] frequency among traded BUYs ===");
const capFreq = new Map<string, number>();
for (const r of buys) {
  let caps: string[] = [];
  try { caps = JSON.parse(r.caps ?? "[]"); } catch { /* ignore */ }
  if (caps.length === 0) capFreq.set("(none)", (capFreq.get("(none)") ?? 0) + 1);
  for (const c of caps) {
    // normalise the dynamic count in "N unknown safety items"
    const key = c.replace(/^\d+ unknown/, "N unknown").replace(/low-coverage\(\d+%\)/, "low-coverage(X%)").replace(/organic<\d+/, "organic<X");
    capFreq.set(key, (capFreq.get(key) ?? 0) + 1);
  }
}
for (const [c, cnt] of [...capFreq.entries()].sort((a, b) => b[1] - a[1])) {
  p(`  ${String(cnt).padStart(6)} (${((cnt / Math.max(buys.length, 1)) * 100).toFixed(1)}%)  ${c}`);
}

// BUY_STRONG reached at all?
const strong = rows.filter((r) => r.verdict === "BUY_STRONG").length;
p(`\nBUY_STRONG count: ${strong}`);

// Is the 59 peg recent or old? Distribution of distinct convictions over time-ordered halves.
const ordered = db.prepare("SELECT conviction, verdict FROM signals ORDER BY at ASC").all() as Array<{ conviction: number; verdict: string }>;
const buysOrdered = ordered.filter((r) => r.verdict === "BUY_SMALL" || r.verdict === "BUY_STRONG");
if (buysOrdered.length >= 4) {
  const half = Math.floor(buysOrdered.length / 2);
  const firstHalf = buysOrdered.slice(0, half).map((r) => r.conviction);
  const secondHalf = buysOrdered.slice(half).map((r) => r.conviction);
  const distinct = (xs: number[]) => new Set(xs).size;
  p("\n=== BUY conviction: oldest half vs newest half (is 59-peg fixed forever?) ===");
  p(`  oldest half: n=${firstHalf.length} median=${median(firstHalf)} distinct=${distinct(firstHalf)} %@59=${((firstHalf.filter((x) => x === 59).length / firstHalf.length) * 100).toFixed(1)}%`);
  p(`  newest half: n=${secondHalf.length} median=${median(secondHalf)} distinct=${distinct(secondHalf)} %@59=${((secondHalf.filter((x) => x === 59).length / secondHalf.length) * 100).toFixed(1)}%`);
}

console.log(out.join("\n"));
db.close();
