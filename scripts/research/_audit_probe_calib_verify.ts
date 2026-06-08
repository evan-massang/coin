import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const TRADED = "verdict IN ('BUY_SMALL','BUY_STRONG')";

type Row = {
  id: number;
  at: number;
  conviction: number | null;
  price_at_alert: number | null;
  price_1h: number | null;
  price_5m: number | null;
  price_15m: number | null;
  max_gain_pct: number | null;
  max_drawdown_pct: number | null;
};

// Universe: traded BUYs with conviction + entry + 1h price + max_gain + dd
const rows = db
  .prepare(
    `SELECT id, at, conviction, price_at_alert, price_1h, price_5m, price_15m, max_gain_pct, max_drawdown_pct
       FROM signals
      WHERE ${TRADED} AND conviction IS NOT NULL`,
  )
  .all() as Row[];

console.log("Total traded w/ conviction:", rows.length);

function fwd1h(r: Row): number | null {
  if (r.price_at_alert == null || r.price_at_alert <= 0 || r.price_1h == null) return null;
  return (r.price_1h - r.price_at_alert) / r.price_at_alert;
}

const buckets: { name: string; test: (c: number) => boolean }[] = [
  { name: "55-58", test: (c) => c >= 55 && c < 59 },
  { name: "59", test: (c) => c === 59 },
  { name: "60-71", test: (c) => c >= 60 && c < 72 },
  { name: "72+ STRONG", test: (c) => c >= 72 },
];

function report(universe: Row[], label: string) {
  console.log(`\n=== ${label} (n=${universe.length}) ===`);
  console.log("bucket".padEnd(14), "n".padStart(5), "2x%".padStart(7), "meanFwd1h%".padStart(12), "medFwd1h%".padStart(11), "meanDD%".padStart(9), "nFwd".padStart(6));
  for (const b of buckets) {
    const xs = universe.filter((r) => r.conviction != null && b.test(r.conviction));
    if (!xs.length) { console.log(b.name.padEnd(14), "0".padStart(5)); continue; }
    // 2x rate uses max_gain_pct (resolved)
    const resolved = xs.filter((r) => r.max_gain_pct != null);
    const wins = resolved.filter((r) => (r.max_gain_pct ?? 0) >= 100).length;
    const twoX = resolved.length ? (100 * wins / resolved.length) : NaN;
    // fwd 1h
    const fwds = xs.map(fwd1h).filter((x): x is number => x != null);
    const meanF = fwds.length ? fwds.reduce((a, x) => a + x, 0) / fwds.length * 100 : NaN;
    const sortedF = [...fwds].sort((a, b2) => a - b2);
    const medF = sortedF.length ? sortedF[Math.floor(sortedF.length / 2)]! * 100 : NaN;
    // dd
    const dds = xs.map((r) => r.max_drawdown_pct).filter((x): x is number => x != null);
    const meanDD = dds.length ? dds.reduce((a, x) => a + x, 0) / dds.length : NaN;
    console.log(
      b.name.padEnd(14),
      String(xs.length).padStart(5),
      (isNaN(twoX) ? "n/a" : twoX.toFixed(1)).padStart(7),
      (isNaN(meanF) ? "n/a" : meanF.toFixed(1)).padStart(12),
      (isNaN(medF) ? "n/a" : medF.toFixed(1)).padStart(11),
      (isNaN(meanDD) ? "n/a" : meanDD.toFixed(1)).padStart(9),
      String(fwds.length).padStart(6),
    );
  }
}

// Spearman rank correlation
function spearman(pairs: [number, number][]): number {
  const n = pairs.length;
  if (n < 3) return NaN;
  const rank = (vals: number[]): number[] => {
    const idx = vals.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n).fill(0);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && idx[j + 1]![0] === idx[i]![0]) j++;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]![1]] = avgRank;
      i = j + 1;
    }
    return r;
  };
  const xr = rank(pairs.map((p) => p[0]));
  const yr = rank(pairs.map((p) => p[1]));
  const mx = xr.reduce((a, b) => a + b, 0) / n;
  const my = yr.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xr[i]! - mx) * (yr[i]! - my);
    dx += (xr[i]! - mx) ** 2;
    dy += (yr[i]! - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

report(rows, "ALL-HISTORY");

// Current regime = newest 30% by `at`
const sortedByAt = [...rows].sort((a, b) => a.at - b.at);
const cut = Math.floor(sortedByAt.length * 0.70);
const recent = sortedByAt.slice(cut);
report(recent, "CURRENT REGIME (newest 30%)");

// Spearman conviction vs fwd1h
const pairsFwd: [number, number][] = rows
  .filter((r) => r.conviction != null && fwd1h(r) != null)
  .map((r) => [r.conviction!, fwd1h(r)!]);
console.log(`\nSpearman conviction vs fwd1h: rho=${spearman(pairsFwd).toFixed(3)} (n=${pairsFwd.length})`);

// Spearman conviction vs 2x indicator
const pairs2x: [number, number][] = rows
  .filter((r) => r.conviction != null && r.max_gain_pct != null)
  .map((r) => [r.conviction!, (r.max_gain_pct ?? 0) >= 100 ? 1 : 0]);
console.log(`Spearman conviction vs 2x: rho=${spearman(pairs2x).toFixed(3)} (n=${pairs2x.length})`);

// Spearman conviction vs max_drawdown
const pairsDD: [number, number][] = rows
  .filter((r) => r.conviction != null && r.max_drawdown_pct != null)
  .map((r) => [r.conviction!, r.max_drawdown_pct!]);
console.log(`Spearman conviction vs maxDD: rho=${spearman(pairsDD).toFixed(3)} (n=${pairsDD.length})`);

// Spearman conviction vs max_gain (continuous)
const pairsGain: [number, number][] = rows
  .filter((r) => r.conviction != null && r.max_gain_pct != null)
  .map((r) => [r.conviction!, r.max_gain_pct!]);
console.log(`Spearman conviction vs maxGain(cont): rho=${spearman(pairsGain).toFixed(3)} (n=${pairsGain.length})`);

// conviction distribution among traded
const dist = db.prepare(`SELECT conviction, COUNT(*) n FROM signals WHERE ${TRADED} GROUP BY conviction ORDER BY conviction`).all() as any[];
console.log("\nConviction distribution (traded):");
for (const r of dist) console.log(`  conv=${r.conviction} n=${r.n}`);

// time window span
const span = db.prepare(`SELECT MIN(at) lo, MAX(at) hi, COUNT(*) n FROM signals WHERE ${TRADED}`).get() as any;
console.log(`\nTraded time span: lo=${new Date(span.lo).toISOString()} hi=${new Date(span.hi).toISOString()} n=${span.n}`);
console.log(`hours: ${((span.hi - span.lo) / 3.6e6).toFixed(1)}`);

// How many traded have price_1h vs not
const has1h = rows.filter((r) => fwd1h(r) != null).length;
console.log(`\ntraded w/ usable fwd1h: ${has1h} / ${rows.length}`);
const hasGain = rows.filter((r) => r.max_gain_pct != null).length;
console.log(`traded w/ max_gain_pct: ${hasGain} / ${rows.length}`);

db.close();
