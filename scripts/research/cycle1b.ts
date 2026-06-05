/** Research Cycle 1 — root-cause deep dive (READ-ONLY). Why never a BUY? */
import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const out: string[] = []; const p = (s = "") => out.push(s);
const J = (v: unknown): unknown[] => { try { const x = JSON.parse(String(v)); return Array.isArray(x) ? x : []; } catch { return []; } };
const JO = (v: unknown): Record<string, number> => { try { return JSON.parse(String(v)); } catch { return {}; } };

const conv = db.prepare("SELECT MIN(conviction) mn, MAX(conviction) mx, AVG(conviction) av FROM signals").get() as { mn: number; mx: number; av: number };
p(`conviction across ALL ${ (db.prepare("SELECT COUNT(*) n FROM signals").get() as {n:number}).n } signals: min=${conv.mn} max=${conv.mx} avg=${conv.av?.toFixed(1)}`);
p("conviction histogram:");
for (const [lo, hi] of [[0,40],[40,50],[50,55],[55,72],[72,101]]) {
  const n = (db.prepare("SELECT COUNT(*) n FROM signals WHERE conviction>=? AND conviction<?").get(lo, hi) as {n:number}).n;
  p(`  ${lo}-${hi}: ${n}`);
}
p(`  (BUY needs conviction >= 55 for BUY_SMALL, >= 72 for BUY_STRONG)`);

// which caps fire most (caps explain why conviction is throttled)
const capCount = new Map<string, number>();
for (const r of db.prepare("SELECT caps FROM signals WHERE caps IS NOT NULL").all() as Array<{caps:string}>) for (const c of J(r.caps)) capCount.set(String(c), (capCount.get(String(c)) ?? 0) + 1);
p("\ntop conviction caps (what throttles conviction):");
[...capCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12).forEach(([c,n])=>p(`  ${n.toString().padStart(6)}  ${c}`));

// top flags + reasons
const flagCount = new Map<string, number>();
for (const r of db.prepare("SELECT flags FROM signals WHERE flags IS NOT NULL").all() as Array<{flags:string}>) for (const c of J(r.flags)) flagCount.set(String(c), (flagCount.get(String(c)) ?? 0) + 1);
p("\ntop flags:");
[...flagCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([c,n])=>p(`  ${n.toString().padStart(6)}  ${c}`));

// are score facets stuck at defaults? distinct value counts for WATCH signals
p("\nscore-facet distinct values (WATCH_ONLY) — few distinct ⇒ stuck at default:");
const sample = db.prepare("SELECT scores FROM signals WHERE verdict='WATCH_ONLY' LIMIT 2000").all() as Array<{scores:string}>;
for (const f of ["organic","momentum","smartMoney","devReputation","graduation","social","hype","safety"]) {
  const vals = new Map<number, number>();
  for (const r of sample) { const v = Math.round(JO(r.scores)[f] ?? -1); vals.set(v, (vals.get(v)??0)+1); }
  const top = [...vals.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([v,n])=>`${v}(${Math.round(n/sample.length*100)}%)`).join(" ");
  p(`  ${f.padEnd(14)} distinct=${vals.size}  top: ${top}`);
}
// eslint-disable-next-line no-console
console.log(out.join("\n"));
db.close();
