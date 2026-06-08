import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const rows = db
  .prepare(
    `SELECT conviction, scores, max_gain_pct g, hypothetical_pnl_sol h, price_at_alert pa, price_1h p1
       FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND conviction IS NOT NULL`,
  )
  .all() as any[];

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
function spearman(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 3) return NaN;
  const rank = (a: number[]) => {
    const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]);
    const r = new Array(n).fill(0);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && idx[j + 1]![0] === idx[i]![0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]![1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i]! - mx) * (ry[i]! - my); dx += (rx[i]! - mx) ** 2; dy += (ry[i]! - my) ** 2; }
  return num / Math.sqrt(dx * dy);
}
const p = rows.map((r) => {
  let s: any = {};
  try { s = JSON.parse(r.scores || "{}"); } catch { /* ignore */ }
  return { ...r, m: s.momentum, o: s.organic, hy: s.hype };
});
console.log("conviction vs momentum rho =", spearman(p.map((x) => x.conviction), p.map((x) => x.m)).toFixed(3));
console.log("conviction vs organic  rho =", spearman(p.map((x) => x.conviction), p.map((x) => x.o)).toFixed(3));
console.log("conviction vs hype     rho =", spearman(p.map((x) => x.conviction), p.map((x) => x.hy)).toFixed(3));

const withH = rows.filter((r) => r.h != null);
console.log("rows with hypothetical_pnl_sol:", withH.length, "/", rows.length);

const fwd = (r: any) => (r.pa > 0 && r.p1 != null ? ((r.p1 - r.pa) / r.pa) * 100 : null);
const mbk = [[38, 60], [60, 75], [75, 85], [85, 91]];
console.log("\nmomBucket  n  2x%  meanFwd1h%  meanHypoPnlSol");
for (const [lo, hi] of mbk) {
  const xs = p.filter((x) => x.m >= lo && x.m < hi);
  const res = xs.filter((x) => x.g != null);
  const w = res.filter((x) => x.g >= 100).length;
  const f = xs.map(fwd).filter((x): x is number => x != null);
  const h = xs.filter((x) => x.h != null).map((x) => x.h);
  console.log(`${lo}-${hi}  n=${xs.length}  2x=${res.length ? ((100 * w) / res.length).toFixed(1) : "na"}%  fwd1h=${f.length ? mean(f).toFixed(1) : "na"}%  hypoPnl=${h.length ? mean(h).toFixed(4) : "na"} (nH=${h.length})`);
}
console.log("\nconvBucket meanHypoPnlSol / totalHypoPnl");
for (const [lo, hi, nm] of [[55, 59, "55-58"], [59, 60, "59"], [60, 72, "60-71"], [72, 200, "72+"]] as any) {
  const xs = rows.filter((r) => r.conviction >= lo && r.conviction < hi).filter((r) => r.h != null);
  console.log(`${nm}: n=${xs.length} meanHypoPnl=${xs.length ? mean(xs.map((x) => x.h)).toFixed(4) : "na"} totalHypoPnl=${xs.length ? xs.reduce((s: number, x: any) => s + x.h, 0).toFixed(3) : "na"}`);
}

// distinct value counts per facet among traded BUYs (resolved or not)
console.log("\nfacet distinct-value counts among traded BUYs:");
const facets = ["safety", "organic", "momentum", "graduation", "devReputation", "smartMoney", "social", "hype", "lateEntryRisk"];
for (const f of facets) {
  const set = new Set<number>();
  for (const x of p) { let s: any = {}; try { s = JSON.parse(x.scores || "{}"); } catch {} if (typeof s[f] === "number") set.add(s[f]); }
  console.log(`  ${f.padEnd(14)} distinct=${set.size}`);
}
db.close();
