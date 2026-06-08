import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const rows = db.prepare(
  `SELECT verdict, conviction, scores FROM signals WHERE scores IS NOT NULL`
).all() as { verdict: string; conviction: number; scores: string }[];

const facets = ["safety","organic","momentum","graduation","devReputation","smartMoney","social","hype"];

function stat(vals: number[]) {
  const n = vals.length;
  const m = vals.reduce((a,b)=>a+b,0)/n;
  const sd = Math.sqrt(vals.reduce((a,b)=>a+(b-m)**2,0)/n);
  const distinct = new Set(vals.map(v=>Math.round(v*100)/100)).size;
  return { n, mean:+m.toFixed(2), std:+sd.toFixed(3), cov: m? +(sd/m).toFixed(3):0, distinct };
}

function report(label: string, pred: (v:string)=>boolean) {
  const sub = rows.filter(r=>pred(r.verdict));
  console.log(`\n=== ${label} (n=${sub.length}) ===`);
  for (const f of facets) {
    const vals = sub.map(r=>{ try { return (JSON.parse(r.scores)||{})[f]; } catch { return undefined; } })
                    .filter((x):x is number => typeof x === "number");
    if (!vals.length) { console.log(`${f}: no data`); continue; }
    const s = stat(vals);
    console.log(`${f.padEnd(14)} mean=${s.mean} std=${s.std} cov=${s.cov} distinct=${s.distinct}`);
  }
}

const isBuy = (v:string)=> v==="BUY_SMALL"||v==="BUY_STRONG"||v==="BUY"||v.startsWith("BUY");
report("ALL signals", ()=>true);
report("BUYs only", isBuy);

// Conviction clustering among BUYs
const buys = rows.filter(r=>isBuy(r.verdict));
const at59 = buys.filter(r=>r.conviction===59).length;
const band = buys.filter(r=>r.conviction>=50 && r.conviction<=59).length;
console.log(`\nBUY conviction clustering: total=${buys.length} at59=${at59} (${(100*at59/buys.length).toFixed(1)}%) in[50,59]=${band} (${(100*band/buys.length).toFixed(1)}%)`);

// distribution histogram of BUY conviction
const hist: Record<number,number> = {};
for (const b of buys) hist[b.conviction]=(hist[b.conviction]||0)+1;
const top = Object.entries(hist).sort((a,b)=>b[1]-a[1]).slice(0,8);
console.log("Top BUY conviction values:", top.map(([k,v])=>`${k}:${v}`).join("  "));

// Verdict counts
const vc: Record<string,number> = {};
for (const r of rows) vc[r.verdict]=(vc[r.verdict]||0)+1;
console.log("\nVerdict counts:", JSON.stringify(vc));

db.close();
