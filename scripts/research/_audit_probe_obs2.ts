import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

type Row = { verdict: string; conviction: number; scores: string };
const rows = db.prepare("SELECT verdict, conviction, scores FROM signals").all() as Row[];

function facet(r: Row, k: string): number | undefined {
  try { return JSON.parse(r.scores)[k]; } catch { return undefined; }
}

// Scored = anything with facet evidence (organic present). Stage-0 AVOIDs have emptyScores (all 0/neutral?)
// Distinguish scored from stage0-avoid: stage0 avoid uses emptyScores(). Let's inspect.
const groups: Record<string, Row[]> = {};
for (const r of rows) (groups[r.verdict] ??= []).push(r);

function dist(name: string, k: string, subset: Row[]) {
  const vals = subset.map(r => facet(r, k)).filter(v => typeof v === "number") as number[];
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
  console.log(`  ${name}.${k}: n=${vals.length} top=`, top.map(([v,c])=>`${v}:${c}(${(100*c/vals.length).toFixed(1)}%)`).join(" "));
}

const buys = [...(groups["BUY_SMALL"]??[]), ...(groups["BUY_STRONG"]??[])];
console.log("=== BUY signals (n="+buys.length+") facet distributions ===");
for (const k of ["organic","momentum","graduation","devReputation","smartMoney","social","hype","lateEntryRisk","safety"]) dist("BUY", k, buys);

const watch = groups["WATCH_ONLY"]??[];
console.log("=== WATCH_ONLY (n="+watch.length+") ===");
for (const k of ["organic","momentum","devReputation","smartMoney","social","lateEntryRisk"]) dist("WATCH", k, watch);

// dex.confident proxy: NOT (organic==50 AND momentum==50). Among scored signals (WATCH+BUY).
const scored = [...watch, ...buys];
let blind = 0, conf = 0;
for (const r of scored) {
  const o = facet(r,"organic"), m = facet(r,"momentum");
  if (o === 50 && m === 50) blind++; else conf++;
}
console.log(`=== dex-confident proxy among SCORED (WATCH+BUY, n=${scored.length}): confident=${conf} (${(100*conf/scored.length).toFixed(1)}%) blind(50/50)=${blind} (${(100*blind/scored.length).toFixed(1)}%) ===`);

// Among BUYs specifically, any with organic==50 && momentum==50?
const buyBlind = buys.filter(r => facet(r,"organic")===50 && facet(r,"momentum")===50).length;
console.log(`BUYs that are blind 50/50: ${buyBlind} / ${buys.length}`);

// lateEntryRisk on BUYs: how often == 20 (the no-data default)
const ler = buys.map(r=>facet(r,"lateEntryRisk")).filter(v=>typeof v==="number") as number[];
const ler20 = ler.filter(v=>v===20).length;
console.log(`BUY lateEntryRisk==20 (no-data floor): ${ler20}/${ler.length} (${(100*ler20/ler.length).toFixed(1)}%)  max=${Math.max(...ler)} mean=${(ler.reduce((a,b)=>a+b,0)/ler.length).toFixed(1)}`);
