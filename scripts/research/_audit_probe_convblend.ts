/** READ-ONLY probe: verify the conviction-blend miscalibration finding.
 *  npx tsx scripts/research/_audit_probe_convblend.ts
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
  price_1h: number | null;
  max_gain_pct: number | null;
  max_drawdown_pct: number | null;
};

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? NaN : num / den;
}

// Spearman = pearson on ranks
function spearman(xs: number[], ys: number[]): number {
  const rank = (arr: number[]) => {
    const idx = arr.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
    const r = new Array(arr.length).fill(0);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]![1]] = avg;
      i = j + 1;
    }
    return r;
  };
  return pearson(rank(xs), rank(ys));
}

const parse = (r: Row) => {
  try { return r.scores ? JSON.parse(r.scores) : null; } catch { return null; }
};

// ---- ALL signals with scores & a usable entry (for facet vs forward corr) ----
const all = db.prepare(
  `SELECT id, verdict, conviction, scores, price_at_alert, price_5m, price_15m, price_1h, max_gain_pct, max_drawdown_pct
     FROM signals
    WHERE scores IS NOT NULL AND price_at_alert IS NOT NULL AND price_at_alert > 0`
).all() as Row[];

console.log(`total signals w/ scores & entry: ${all.length}`);

// fwd5m return universe
function facetCorr(facet: string, priceCol: "price_5m" | "price_15m" | "price_1h") {
  const xs: number[] = [], ys: number[] = [];
  for (const r of all) {
    const s = parse(r);
    if (!s || s[facet] == null) continue;
    const p = r[priceCol];
    if (p == null || r.price_at_alert == null) continue;
    const fwd = (p - r.price_at_alert) / r.price_at_alert;
    xs.push(s[facet]); ys.push(fwd);
  }
  return { n: xs.length, pearson: pearson(xs, ys), spearman: spearman(xs, ys) };
}

for (const f of ["momentum", "organic", "smartMoney", "devReputation", "graduation"]) {
  const c5 = facetCorr(f, "price_5m");
  const c15 = facetCorr(f, "price_15m");
  console.log(`corr(${f}, fwd5m) n=${c5.n} pearson=${c5.pearson.toFixed(3)} spearman=${c5.spearman.toFixed(3)} | fwd15m pearson=${c15.pearson.toFixed(3)}`);
}

// ---- conviction vs max_gain on TRADED (BUY) ----
const traded = all.filter((r) => r.verdict === "BUY_SMALL" || r.verdict === "BUY_STRONG");
const convArr: number[] = [], gainArr: number[] = [], ddArr: number[] = [];
for (const r of traded) {
  if (r.conviction == null || r.max_gain_pct == null) continue;
  convArr.push(r.conviction); gainArr.push(r.max_gain_pct);
  ddArr.push(r.max_drawdown_pct ?? 0);
}
console.log(`\ntraded BUYs w/ conviction & max_gain: ${convArr.length}`);
console.log(`corr(conviction, max_gain_pct) pearson=${pearson(convArr, gainArr).toFixed(3)} spearman=${spearman(convArr, gainArr).toFixed(3)}`);

// conviction vs forward 5m return on traded
{
  const xs: number[] = [], ys: number[] = [];
  for (const r of traded) {
    if (r.conviction == null || r.price_5m == null || r.price_at_alert == null) continue;
    xs.push(r.conviction); ys.push((r.price_5m - r.price_at_alert) / r.price_at_alert);
  }
  console.log(`corr(conviction, fwd5m) on traded n=${xs.length} pearson=${pearson(xs, ys).toFixed(3)} spearman=${spearman(xs, ys).toFixed(3)}`);
}

// ---- conviction bands: win-rate (max_gain>=100) & mean DD ----
const bands: [string, (c: number) => boolean][] = [
  ["55-59", (c) => c >= 55 && c < 60],
  ["60-71", (c) => c >= 60 && c < 72],
  [">=72", (c) => c >= 72],
];
console.log(`\nconviction bands on traded:`);
for (const [label, pred] of bands) {
  const rs = traded.filter((r) => r.conviction != null && pred(r.conviction) && r.max_gain_pct != null);
  const wins = rs.filter((r) => (r.max_gain_pct ?? 0) >= 100).length;
  const meanDD = rs.length ? rs.reduce((s, r) => s + (r.max_drawdown_pct ?? 0), 0) / rs.length : 0;
  const medGain = (() => {
    const g = rs.map((r) => r.max_gain_pct ?? 0).sort((a, b) => a - b);
    return g.length ? g[Math.floor(g.length / 2)]! : 0;
  })();
  console.log(`  ${label}: n=${rs.length} win(>=2x)=${rs.length ? (100 * wins / rs.length).toFixed(1) : "0"}% meanDD=${meanDD.toFixed(0)}% medGain=${medGain.toFixed(0)}%`);
}

// ---- momentum bands: median forward 5m ----
console.log(`\nmomentum bands median fwd5m (all signals):`);
const mbands: [string, (m: number) => boolean][] = [
  ["0-49", (m) => m < 50],
  ["50-69", (m) => m >= 50 && m < 70],
  ["70-84", (m) => m >= 70 && m < 85],
  [">=85", (m) => m >= 85],
];
for (const [label, pred] of mbands) {
  const fwds: number[] = [];
  for (const r of all) {
    const s = parse(r);
    if (!s || s.momentum == null || !pred(s.momentum)) continue;
    if (r.price_5m == null || r.price_at_alert == null) continue;
    fwds.push((r.price_5m - r.price_at_alert) / r.price_at_alert);
  }
  fwds.sort((a, b) => a - b);
  const med = fwds.length ? fwds[Math.floor(fwds.length / 2)]! : 0;
  console.log(`  mom ${label}: n=${fwds.length} medFwd5m=${(med * 100).toFixed(1)}%`);
}

db.close();
