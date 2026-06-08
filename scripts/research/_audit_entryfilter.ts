/**
 * READ-ONLY: find an ENTRY filter (on signals we ALREADY have) that maximizes
 * REALIZED PnL — using the new shipped exit model via exitOutcomeBounds. No waiting.
 *   npx tsx scripts/research/_audit_entryfilter.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
import { exitOutcomeBounds, type ExitModel } from "../../src/learning/backtester.js";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
type Row = { conviction: number | null; scores: string | null; max_gain_pct: number | null; max_drawdown_pct: number | null };
const raw = db.prepare(
  `SELECT conviction, scores, max_gain_pct, max_drawdown_pct FROM signals
    WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL AND max_drawdown_pct IS NOT NULL`,
).all() as Row[];
db.close();

// The shipped exit model (Cycle 8 iter 2).
const SHIP: ExitModel = { ladder: [[1.4, 0.3], [1.8, 0.3], [2.5, 0.2], [5, 0.1]].map(([multiple, sellPct]) => ({ multiple, sellPct })), trailingStopPct: 0.3, stopLossPct: 0.4, trailingActivateMultiple: 1.25 };

type T = { c: number; organic: number; momentum: number; graduation: number; smartMoney: number; social: number; hype: number; mid: number; pess: number; opt: number };
const trades: T[] = [];
for (const r of raw) {
  let s: any = {}; try { s = JSON.parse(r.scores ?? "{}"); } catch { /* */ }
  const b = exitOutcomeBounds(r.max_gain_pct ?? 0, r.max_drawdown_pct ?? 0, SHIP);
  trades.push({ c: r.conviction ?? 0, organic: s.organic ?? 0, momentum: s.momentum ?? 0, graduation: s.graduation ?? 0, smartMoney: s.smartMoney ?? 0, social: s.social ?? 0, hype: s.hype ?? 0, opt: b.optimistic - 1, pess: b.pessimistic - 1, mid: (b.optimistic + b.pessimistic) / 2 - 1 });
}
const base = trades;
const agg = (rows: T[]) => ({ n: rows.length, mid: rows.length ? rows.reduce((s, x) => s + x.mid, 0) / rows.length : 0, pess: rows.length ? rows.reduce((s, x) => s + x.pess, 0) / rows.length : 0, opt: rows.length ? rows.reduce((s, x) => s + x.opt, 0) / rows.length : 0, win: rows.length ? rows.filter((x) => x.opt > 0).length / rows.length : 0 });
const b0 = agg(base);
console.log(`BASELINE all ${b0.n} BUYs: mid=${(b0.mid * 100).toFixed(1)}% pess=${(b0.pess * 100).toFixed(1)}% opt=${(b0.opt * 100).toFixed(1)}% win=${(b0.win * 100).toFixed(1)}%\n`);

const MIN_N = 60;
type Filter = { name: string; f: (t: T) => boolean };
const facets: { key: keyof T; cuts: number[] }[] = [
  { key: "momentum", cuts: [30, 50, 70, 85] }, { key: "organic", cuts: [40, 55, 70, 85] },
  { key: "c", cuts: [58, 60, 62, 65] }, { key: "graduation", cuts: [40, 55, 70] },
  { key: "smartMoney", cuts: [40, 55, 70] }, { key: "social", cuts: [40, 55] }, { key: "hype", cuts: [40, 55] },
];
const filters: Filter[] = [];
for (const fa of facets) for (const c of fa.cuts) {
  filters.push({ name: `${fa.key}>=${c}`, f: (t) => (t[fa.key] as number) >= c });
  filters.push({ name: `${fa.key}<${c} `, f: (t) => (t[fa.key] as number) < c });
}
// a few combos worth checking
filters.push({ name: "mom<70 & org>=55", f: (t) => t.momentum < 70 && t.organic >= 55 });
filters.push({ name: "mom 40-80 & c>=60", f: (t) => t.momentum >= 40 && t.momentum < 80 && t.c >= 60 });
filters.push({ name: "organic>=70 & grad>=55", f: (t) => t.organic >= 70 && t.graduation >= 55 });
filters.push({ name: "smartMoney>=55 & mom<80", f: (t) => t.smartMoney >= 55 && t.momentum < 80 });

const scored = filters.map((flt) => ({ name: flt.name, ...agg(base.filter(flt.f)) })).filter((s) => s.n >= MIN_N);
scored.sort((a, b) => b.mid - a.mid);
console.log(`top filters by realized mid (min n=${MIN_N}), vs baseline mid ${(b0.mid * 100).toFixed(1)}%:`);
console.log(`   ${"filter".padEnd(24)} ${"n".padStart(5)} ${"mid".padStart(7)} ${"pess".padStart(7)} ${"opt".padStart(7)} ${"win%".padStart(6)}`);
for (const s of scored.slice(0, 14)) console.log(`   ${s.name.padEnd(24)} ${String(s.n).padStart(5)} ${(s.mid * 100).toFixed(1).padStart(7)} ${(s.pess * 100).toFixed(1).padStart(7)} ${(s.opt * 100).toFixed(1).padStart(7)} ${(s.win * 100).toFixed(1).padStart(6)}`);
