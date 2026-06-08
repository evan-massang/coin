import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const rows = db
  .prepare(
    `SELECT conviction, scores, max_gain_pct g, price_at_alert pa, price_1h p1, price_5m p5, price_15m p15
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
  try { s = JSON.parse(r.scores || "{}"); } catch {}
  return { ...r, m: s.momentum, o: s.organic };
});
const fwd1h = (r: any) => (r.pa > 0 && r.p1 != null ? ((r.p1 - r.pa) / r.pa) * 100 : null);

// momentum vs fwd1h (only rows with both)
const withFwd = p.filter((x) => typeof x.m === "number" && fwd1h(x) != null);
console.log("n with momentum & fwd1h:", withFwd.length);
console.log("momentum vs fwd1h rho =", spearman(withFwd.map((x) => x.m), withFwd.map((x) => fwd1h(x)!)).toFixed(3));
console.log("organic  vs fwd1h rho =", spearman(p.filter((x)=>typeof x.o==="number"&&fwd1h(x)!=null).map((x)=>x.o), p.filter((x)=>typeof x.o==="number"&&fwd1h(x)!=null).map((x)=>fwd1h(x)!)).toFixed(3));

// momentum vs 2x indicator (resolved only)
const res = p.filter((x) => typeof x.m === "number" && x.g != null);
console.log("\nn resolved (max_gain_pct):", res.length);
console.log("momentum vs 2x-indicator rho =", spearman(res.map((x) => x.m), res.map((x) => (x.g >= 100 ? 1 : 0))).toFixed(3));
console.log("conviction vs fwd1h rho =", spearman(withFwd.map((x) => x.conviction), withFwd.map((x) => fwd1h(x)!)).toFixed(3));
console.log("conviction vs 2x-indicator rho =", spearman(res.map((x) => x.conviction), res.map((x) => (x.g >= 100 ? 1 : 0))).toFixed(3));

// What fraction of BUYs would minMomentumForBuy=85 select, and their fwd1h / 2x?
const hi = p.filter((x) => typeof x.m === "number" && x.m >= 85);
const hiFwd = hi.map(fwd1h).filter((x): x is number => x != null);
const hiRes = hi.filter((x) => x.g != null);
console.log("\nminMomentumForBuy>=85 cohort: n=", hi.length, "of", p.length, "=", (100*hi.length/p.length).toFixed(1)+"%");
console.log("  meanFwd1h=", hiFwd.length?mean(hiFwd).toFixed(1):"na", "% | 2x%=", hiRes.length?(100*hiRes.filter(x=>x.g>=100).length/hiRes.length).toFixed(1):"na");
const lo = p.filter((x) => typeof x.m === "number" && x.m < 85);
const loFwd = lo.map(fwd1h).filter((x): x is number => x != null);
const loRes = lo.filter((x) => x.g != null);
console.log("momentum<85 cohort: n=", lo.length, " meanFwd1h=", loFwd.length?mean(loFwd).toFixed(1):"na", "% | 2x%=", loRes.length?(100*loRes.filter(x=>x.g>=100).length/loRes.length).toFixed(1):"na");

// median fwd1h (robustness vs mean which can be skewed)
const med = (a: number[]) => { const s=[...a].sort((x,y)=>x-y); return s.length?s[Math.floor(s.length/2)]:NaN; };
console.log("\nmedian fwd1h: >=85 =", hiFwd.length?med(hiFwd)!.toFixed(1):"na", " <85 =", loFwd.length?med(loFwd)!.toFixed(1):"na");
db.close();
