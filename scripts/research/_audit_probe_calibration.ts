import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

type Row = {
  at: number;
  conviction: number;
  verdict: string;
  scores: string | null;
  price_at_alert: number | null;
  price_5m: number | null;
  price_15m: number | null;
  price_1h: number | null;
  max_gain_pct: number | null;
  max_drawdown_pct: number | null;
};

const all = db
  .prepare(
    `SELECT at, conviction, verdict, scores, price_at_alert, price_5m, price_15m, price_1h, max_gain_pct, max_drawdown_pct
       FROM signals
      WHERE verdict IN ('BUY_SMALL','BUY_STRONG')
        AND conviction IS NOT NULL`,
  )
  .all() as Row[];

const mm = db.prepare(`SELECT MIN(at) mn, MAX(at) mx FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')`).get() as any;
console.log(`traded BUYs total: ${all.length}`);
console.log(`at range: ${new Date(mm.mn).toISOString()} -> ${new Date(mm.mx).toISOString()}`);

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const std = (a: number[]) => {
  if (a.length < 2) return NaN;
  const mu = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / (a.length - 1));
};
const fwd = (r: Row, p: number | null) =>
  r.price_at_alert && r.price_at_alert > 0 && p != null ? (p - r.price_at_alert) / r.price_at_alert : null;

const buckets: { name: string; test: (c: number) => boolean }[] = [
  { name: "55-58", test: (c) => c >= 55 && c < 59 },
  { name: "59 (peg)", test: (c) => c === 59 },
  { name: "60-71", test: (c) => c >= 60 && c < 72 },
  { name: "72+ STRONG", test: (c) => c >= 72 },
];

function calib(rows: Row[], label: string) {
  console.log(`\n===== ${label} (n=${rows.length}) =====`);
  console.log(
    "bucket".padEnd(12),
    "n".padStart(5),
    "res".padStart(5),
    "2x%".padStart(6),
    "meanFwd5m%".padStart(11),
    "meanFwd15m%".padStart(12),
    "meanFwd1h%".padStart(11),
    "medFwd1h%".padStart(10),
    "meanDD%".padStart(8),
  );
  for (const b of buckets) {
    const xs = rows.filter((r) => b.test(r.conviction));
    const res = xs.filter((r) => r.max_gain_pct != null);
    const wins = res.filter((r) => (r.max_gain_pct ?? 0) >= 100).length;
    const f5 = xs.map((r) => fwd(r, r.price_5m)).filter((x): x is number => x != null).map((x) => x * 100);
    const f15 = xs.map((r) => fwd(r, r.price_15m)).filter((x): x is number => x != null).map((x) => x * 100);
    const f1h = xs.map((r) => fwd(r, r.price_1h)).filter((x): x is number => x != null).map((x) => x * 100);
    const dd = res.map((r) => r.max_drawdown_pct ?? 0);
    console.log(
      b.name.padEnd(12),
      String(xs.length).padStart(5),
      String(res.length).padStart(5),
      (res.length ? ((100 * wins) / res.length).toFixed(1) : "n/a").padStart(6),
      (f5.length ? mean(f5).toFixed(1) : "n/a").padStart(11),
      (f15.length ? mean(f15).toFixed(1) : "n/a").padStart(12),
      (f1h.length ? mean(f1h).toFixed(1) : "n/a").padStart(11),
      (f1h.length ? median(f1h).toFixed(1) : "n/a").padStart(10),
      (dd.length ? mean(dd).toFixed(1) : "n/a").padStart(8),
    );
  }
}

// Full history
calib(all, "ALL HISTORY traded BUYs");

// Regime split: define recent regime as post the unpeg. Use the median timestamp as a split,
// and also a "newest 40%" cut. Also report each half's %@59 to confirm regime change.
const sorted = [...all].sort((a, b) => a.at - b.at);
const half = Math.floor(sorted.length / 2);
const oldH = sorted.slice(0, half);
const newH = sorted.slice(half);
const pegPct = (rs: Row[]) => ((100 * rs.filter((r) => r.conviction === 59).length) / rs.length).toFixed(1);
console.log(`\n%@59 oldest half=${pegPct(oldH)}  newest half=${pegPct(newH)}`);
calib(newH, "NEWEST HALF (post-unpeg regime)");

// Recent regime more strictly: signals where conviction != 59 dominate. Take rows where the
// engine was clearly running the unpegged scorer: newest 30%.
const tail = sorted.slice(Math.floor(sorted.length * 0.7));
console.log(`\nnewest 30% at range: ${new Date(tail[0]!.at).toISOString()} -> ${new Date(tail[tail.length-1]!.at).toISOString()}, %@59=${pegPct(tail)}`);
calib(tail, "NEWEST 30% traded BUYs");

// ---- FACET VARIANCE among traded BUYs: can any sub-score discriminate? ----
console.log(`\n===== FACET DISTRIBUTION among traded BUYs (resolved only) =====`);
const facets = ["safety", "organic", "momentum", "graduation", "devReputation", "smartMoney", "social", "hype", "lateEntryRisk"];
const resolved = all.filter((r) => r.max_gain_pct != null);
const parsed = resolved.map((r) => {
  let s: any = {};
  try { s = JSON.parse(r.scores ?? "{}"); } catch { /* ignore */ }
  return { r, s };
});
console.log("facet".padEnd(15), "mean".padStart(7), "median".padStart(7), "std".padStart(7), "min".padStart(6), "max".padStart(6), "CoV".padStart(7));
for (const f of facets) {
  const vals = parsed.map((p) => p.s[f]).filter((x) => typeof x === "number") as number[];
  if (!vals.length) { console.log(f.padEnd(15), "(no data)"); continue; }
  const mu = mean(vals), sd = std(vals);
  console.log(
    f.padEnd(15),
    mu.toFixed(1).padStart(7),
    median(vals).toFixed(1).padStart(7),
    sd.toFixed(1).padStart(7),
    Math.min(...vals).toFixed(0).padStart(6),
    Math.max(...vals).toFixed(0).padStart(6),
    (sd / mu).toFixed(2).padStart(7),
  );
}

// ---- Spearman rank correlation: conviction vs forward1h, and each facet vs forward1h & vs 2x ----
function spearman(xs: number[], ys: number[]): number {
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
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

console.log(`\n===== RANK CORRELATION (Spearman) vs forward-1h return & vs 2x outcome =====`);
const withF1h = parsed.filter((p) => fwd(p.r, p.r.price_1h) != null);
const conv1h = spearman(withF1h.map((p) => p.r.conviction), withF1h.map((p) => fwd(p.r, p.r.price_1h)!));
const win = (p: any) => ((p.r.max_gain_pct ?? 0) >= 100 ? 1 : 0);
const convWin = spearman(parsed.map((p) => p.r.conviction), parsed.map(win));
console.log(`conviction vs fwd1h:  rho=${conv1h.toFixed(3)} (n=${withF1h.length})`);
console.log(`conviction vs 2x:     rho=${convWin.toFixed(3)} (n=${parsed.length})`);
for (const f of ["organic", "momentum", "graduation", "social", "hype", "smartMoney", "devReputation"]) {
  const wf = withF1h.filter((p) => typeof p.s[f] === "number");
  const rhoF = spearman(wf.map((p) => p.s[f] as number), wf.map((p) => fwd(p.r, p.r.price_1h)!));
  const wj = parsed.filter((p) => typeof p.s[f] === "number");
  const rhoW = spearman(wj.map((p) => p.s[f] as number), wj.map(win));
  console.log(`${f.padEnd(14)} vs fwd1h rho=${rhoF.toFixed(3)}   vs 2x rho=${rhoW.toFixed(3)}`);
}

// ---- Implied-probability calibration error: treat conviction/100 as P(2x)? ----
console.log(`\n===== conviction as implied prob vs actual 2x rate =====`);
for (const b of buckets) {
  const xs = resolved.filter((r) => b.test(r.conviction));
  if (!xs.length) continue;
  const meanConv = mean(xs.map((r) => r.conviction));
  const actual2x = (100 * xs.filter((r) => (r.max_gain_pct ?? 0) >= 100).length) / xs.length;
  console.log(`${b.name.padEnd(12)} meanConv=${meanConv.toFixed(1)} impliedP~=${meanConv.toFixed(0)}%  actual2x=${actual2x.toFixed(1)}%  gap=${(meanConv - actual2x).toFixed(1)}pp`);
}

db.close();
