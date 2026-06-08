/**
 * AUDIT Finding 7 — PRE-PUMP PATTERN (READ-ONLY).
 *
 * Question: is there ANY measurable signature in the data we ALREADY have that
 * separates winners (max_gain_pct >= 100, i.e. >=2x) from losers — for traded
 * BUYs and for the wider WATCH/BUY universe?
 *
 * We compare, winners vs losers:
 *   - scores facets: organic, momentum, graduation, lateEntryRisk (+ others)
 *   - parsed reasons[] dex line: "dex: N txns/5m, buy-pressure organic X"
 *   - parsed "buy pressure X%" line
 * Separation metric per feature: AUC (probability a random winner ranks above a
 * random loser) + Cohen's d (standardized mean diff). AUC 0.5 = no signal,
 * |d|<0.2 = negligible.  We also bucket each feature into terciles and report the
 * winner-rate per bucket (a monotone lift => usable threshold).
 *
 *   npx tsx scripts/research/_audit_prepump.ts
 */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const J = (v: unknown): Record<string, number> => { try { return JSON.parse(String(v)); } catch { return {}; } };
const A = (v: unknown): string[] => { try { const x = JSON.parse(String(v)); return Array.isArray(x) ? x.map(String) : []; } catch { return []; } };

const out: string[] = [];
const p = (s = "") => out.push(s);

type Row = Record<string, unknown>;

// Parse the DexScreener facts out of reasons[] (the free-feed signal the engine acts on).
function parseReasons(reasons: string[]): { txns5m: number; bpOrganic: number; buyPressurePct: number } {
  let txns5m = NaN, bpOrganic = NaN, buyPressurePct = NaN;
  for (const line of reasons) {
    let m = line.match(/dex:\s*([0-9.]+)\s*txns\/5m.*?buy-pressure organic\s*([0-9.]+)/i);
    if (m) { txns5m = Number(m[1]); bpOrganic = Number(m[2]); }
    m = line.match(/buy pressure\s*([0-9.]+)\s*%/i);
    if (m) buyPressurePct = Number(m[1]);
  }
  return { txns5m, bpOrganic, buyPressurePct };
}

const FACETS = ["organic", "momentum", "graduation", "lateEntryRisk", "devReputation", "smartMoney", "social", "hype", "safety"];

// Build a feature vector per row.
function features(r: Row): Record<string, number> {
  const s = J(r.scores);
  const dex = parseReasons(A(r.reasons));
  const f: Record<string, number> = {};
  for (const k of FACETS) f[`score.${k}`] = num(s[k]);
  f["dex.txns5m"] = dex.txns5m;
  f["dex.bpOrganic"] = dex.bpOrganic;
  f["dex.buyPressurePct"] = dex.buyPressurePct;
  f["conviction"] = num(r.conviction);
  return f;
}

const isWin = (r: Row) => num(r.max_gain_pct) >= 100;

// AUC via Mann-Whitney U (winners as the "positive" class). Ignores NaN.
function auc(winVals: number[], loseVals: number[]): { auc: number; nW: number; nL: number } {
  const W = winVals.filter((x) => Number.isFinite(x));
  const L = loseVals.filter((x) => Number.isFinite(x));
  if (W.length === 0 || L.length === 0) return { auc: NaN, nW: W.length, nL: L.length };
  // rank all, average ties
  const all = [...W.map((v) => ({ v, w: 1 })), ...L.map((v) => ({ v, w: 0 }))].sort((a, b) => a.v - b.v);
  let i = 0, rankSumW = 0, rank = 1;
  while (i < all.length) {
    let j = i; while (j + 1 < all.length && all[j + 1]!.v === all[i]!.v) j++;
    const avgRank = (rank + (rank + (j - i))) / 2;
    for (let k = i; k <= j; k++) if (all[k]!.w === 1) rankSumW += avgRank;
    rank += (j - i + 1); i = j + 1;
  }
  const U = rankSumW - (W.length * (W.length + 1)) / 2;
  return { auc: U / (W.length * L.length), nW: W.length, nL: L.length };
}

function stats(vals: number[]) {
  const v = vals.filter((x) => Number.isFinite(x));
  if (!v.length) return { mean: NaN, sd: NaN, n: 0, median: NaN };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  const sorted = [...v].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return { mean, sd, n: v.length, median };
}

function cohensD(winVals: number[], loseVals: number[]): number {
  const w = stats(winVals), l = stats(loseVals);
  if (!w.n || !l.n) return NaN;
  const pooled = Math.sqrt(((w.n - 1) * w.sd ** 2 + (l.n - 1) * l.sd ** 2) / Math.max(1, w.n + l.n - 2));
  if (pooled === 0) return NaN;
  return (w.mean - l.mean) / pooled;
}

// Tercile winner-rate: does the feature, thresholded, lift hit-rate? (monotone => usable gate)
function tercileLift(rows: Row[], feat: string): string {
  const withVal = rows.map((r) => ({ v: features(r)[feat]!, win: isWin(r) })).filter((x) => Number.isFinite(x.v));
  if (withVal.length < 9) return "(too few)";
  withVal.sort((a, b) => a.v - b.v);
  const t = Math.floor(withVal.length / 3);
  const lo = withVal.slice(0, t), mid = withVal.slice(t, 2 * t), hi = withVal.slice(2 * t);
  const wr = (g: typeof withVal) => g.length ? (100 * g.filter((x) => x.win).length / g.length) : NaN;
  const rng = (g: typeof withVal) => g.length ? `${g[0]!.v.toFixed(0)}..${g[g.length - 1]!.v.toFixed(0)}` : "-";
  return `lo[${rng(lo)}]=${wr(lo).toFixed(1)}%  mid[${rng(mid)}]=${wr(mid).toFixed(1)}%  hi[${rng(hi)}]=${wr(hi).toFixed(1)}%`;
}

function analyze(label: string, rows: Row[]) {
  const winners = rows.filter(isWin), losers = rows.filter((r) => !isWin(r));
  p(`\n${"=".repeat(78)}`);
  p(`# ${label}`);
  p(`resolved=${rows.length}  winners(>=2x)=${winners.length} (${(100 * winners.length / Math.max(1, rows.length)).toFixed(1)}%)  losers=${losers.length}`);
  if (winners.length < 3 || losers.length < 3) { p("  (need >=3 each — skipping)"); return; }

  const allFeats = Object.keys(features(rows[0]!));
  type FR = { feat: string; auc: number; d: number; mW: number; mL: number; nW: number; nL: number };
  const results: FR[] = [];
  for (const feat of allFeats) {
    const wv = winners.map((r) => features(r)[feat]!);
    const lv = losers.map((r) => features(r)[feat]!);
    const a = auc(wv, lv);
    results.push({ feat, auc: a.auc, d: cohensD(wv, lv), mW: stats(wv).mean, mL: stats(lv).mean, nW: a.nW, nL: a.nL });
  }
  // sort by separation power (distance of AUC from 0.5)
  results.sort((a, b) => (Math.abs((b.auc || 0.5) - 0.5)) - (Math.abs((a.auc || 0.5) - 0.5)));
  p("");
  p("feature                 |   AUC | Cohen d | mean(W) | mean(L) |  nW/nL  | verdict");
  p("-".repeat(86));
  for (const r of results) {
    const sepAuc = Number.isFinite(r.auc) ? Math.abs(r.auc - 0.5) : NaN;
    let v = "noise";
    if (Number.isFinite(sepAuc)) {
      if (sepAuc >= 0.15 && Math.abs(r.d) >= 0.5) v = "STRONG";
      else if (sepAuc >= 0.08 && Math.abs(r.d) >= 0.2) v = "weak";
    } else v = "n/a";
    p(
      `${r.feat.padEnd(23)} | ${(Number.isFinite(r.auc) ? r.auc.toFixed(3) : " n/a ").padStart(5)} | ${(Number.isFinite(r.d) ? (r.d >= 0 ? "+" : "") + r.d.toFixed(2) : "n/a").padStart(7)} | ${(Number.isFinite(r.mW) ? r.mW.toFixed(1) : "-").padStart(7)} | ${(Number.isFinite(r.mL) ? r.mL.toFixed(1) : "-").padStart(7)} | ${(`${r.nW}/${r.nL}`).padStart(7)} | ${v}`,
    );
  }
  // tercile lift for the candidate free-feed features + top facet
  p("");
  p("tercile winner-rate (monotone lift => usable threshold; flat => no signal):");
  for (const feat of ["dex.txns5m", "dex.bpOrganic", "dex.buyPressurePct", "score.organic", "score.momentum", "score.lateEntryRisk", results[0]!.feat]) {
    p(`  ${feat.padEnd(20)} ${tercileLift(rows, feat)}`);
  }
}

// ---- Dataset A: TRADED BUYs (actually entered) ----
const traded = db.prepare(
  "SELECT symbol, conviction, scores, reasons, max_gain_pct, max_drawdown_pct FROM signals " +
  "WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL",
).all() as Row[];

// ---- Dataset B: ALL scored WATCH/BUY universe (wider sample) ----
const universe = db.prepare(
  "SELECT symbol, verdict, conviction, scores, reasons, max_gain_pct, max_drawdown_pct FROM signals " +
  "WHERE verdict IN ('BUY_SMALL','BUY_STRONG','WATCH_ONLY','WATCH') AND max_gain_pct IS NOT NULL",
).all() as Row[];

p("AUDIT FINDING 7 — PRE-PUMP SIGNATURE TEST (read-only)");
p("WINNER = max_gain_pct >= 100 (>=2x). AUC=0.5 -> no signal; |Cohen d|<0.2 -> negligible.");

analyze("DATASET A: TRADED BUYs (BUY_SMALL/BUY_STRONG, resolved)", traded);
analyze("DATASET B: WIDER UNIVERSE (BUY + WATCH, resolved)", universe);

// data-quality note: how many traded rows actually have parsed dex features?
const haveDex = traded.filter((r) => Number.isFinite(parseReasons(A(r.reasons)).txns5m)).length;
p(`\n[data quality] traded rows with a parseable 'dex: N txns/5m' line: ${haveDex}/${traded.length}`);
const haveBp = traded.filter((r) => Number.isFinite(parseReasons(A(r.reasons)).buyPressurePct)).length;
p(`[data quality] traded rows with a parseable 'buy pressure X%' line:  ${haveBp}/${traded.length}`);

// eslint-disable-next-line no-console
console.log(out.join("\n"));
db.close();
