/**
 * Cycle 5 failure analysis (READ-ONLY): the win rate (8.9%) is structurally too
 * low to profit by picking MORE winners on free data. The other lever is
 * AVOIDING the catastrophic losers. Do the deep losers share a pre-trade
 * signature (a facet/flag/cap the engine could gate on) that the survivors lack?
 *   tsx scripts/research/cycle5-loser-postmortem.ts
 */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const J = (v: unknown): Record<string, number> => { try { return JSON.parse(String(v)); } catch { return {}; } };
const A = (v: unknown): string[] => { try { const x = JSON.parse(String(v)); return Array.isArray(x) ? x : []; } catch { return []; } };

// Traded signals only (what actually entered): BUY_SMALL / BUY_STRONG with a resolved path.
const rows = db.prepare(
  "SELECT symbol, conviction, scores, flags, caps, red_flags, max_gain_pct, max_drawdown_pct, real_pnl_sol " +
    "FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL",
).all() as Array<Record<string, unknown>>;

const out: string[] = []; const p = (s = "") => out.push(s);
p(`# CYCLE 5 — TRADED-LOSER POSTMORTEM (traded+resolved = ${rows.length})`);

const isWin = (r: Record<string, unknown>) => num(r.max_gain_pct) >= 100 || num(r.real_pnl_sol) > 0;
const dd = (r: Record<string, unknown>) => num(r.max_drawdown_pct);
const winners = rows.filter(isWin);
const losers = rows.filter((r) => !isWin(r));
const deep = losers.filter((r) => dd(r) >= 60);   // catastrophic
const shallow = losers.filter((r) => dd(r) < 60);
p(`winners=${winners.length}  losers=${losers.length}  (deep>=60%dd=${deep.length}, shallow=${shallow.length})`);
p("");

const facets = ["organic", "momentum", "graduation", "lateEntryRisk", "social", "hype", "safety"];
const avgF = (set: Array<Record<string, unknown>>, f: string) => set.length ? set.reduce((a, r) => a + num(J(r.scores)[f]), 0) / set.length : 0;
const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

p(`mean facet by bucket (does any facet flag the deep losers BEFORE entry?):`);
p(`facet          | winners | shallowLose | DEEP-lose`);
for (const f of facets) {
  p(`  ${f.padEnd(13)}| ${avgF(winners, f).toFixed(1).padStart(7)} | ${avgF(shallow, f).toFixed(1).padStart(11)} | ${avgF(deep, f).toFixed(1).padStart(8)}`);
}
p(`  conviction   | ${avg(winners.map((r) => num(r.conviction))).toFixed(1).padStart(7)} | ${avg(shallow.map((r) => num(r.conviction))).toFixed(1).padStart(11)} | ${avg(deep.map((r) => num(r.conviction))).toFixed(1).padStart(8)}`);
p(`  meanDrawdown%| ${avg(winners.map(dd)).toFixed(1).padStart(7)} | ${avg(shallow.map(dd)).toFixed(1).padStart(11)} | ${avg(deep.map(dd)).toFixed(1).padStart(8)}`);
p("");

// flag / cap / red-flag frequency by bucket
const tally = (set: Array<Record<string, unknown>>, col: string) => {
  const c: Record<string, number> = {};
  for (const r of set) for (const t of A(r[col])) c[t] = (c[t] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(", ") || "(none)";
};
for (const col of ["flags", "caps", "red_flags"]) {
  p(`${col}:`);
  p(`  winners : ${tally(winners, col)}`);
  p(`  shallow : ${tally(shallow, col)}`);
  p(`  DEEP    : ${tally(deep, col)}`);
}
p("");

// the worst 12 trades, with their pre-trade facets — eyeball for a signature
p(`worst 12 by drawdown (symbol | dd% | gain% | conv | mom | org | grad | late | flags):`);
[...rows].sort((a, b) => dd(b) - dd(a)).slice(0, 12).forEach((r) => {
  const s = J(r.scores);
  p(`  ${String(r.symbol ?? "?").padEnd(10)} dd=${dd(r).toFixed(0).padStart(3)} gain=${num(r.max_gain_pct).toFixed(0).padStart(4)} conv=${num(r.conviction).toString().padStart(2)} mom=${num(s.momentum).toString().padStart(3)} org=${num(s.organic).toString().padStart(3)} grad=${num(s.graduation).toString().padStart(3)} late=${num(s.lateEntryRisk).toString().padStart(3)} [${A(r.flags).join(",")}]`);
});

// eslint-disable-next-line no-console
console.log(out.join("\n"));
db.close();
