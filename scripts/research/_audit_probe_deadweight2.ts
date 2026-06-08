import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const rows = db.prepare(`SELECT verdict, conviction, scores FROM signals WHERE verdict LIKE 'BUY%' AND scores IS NOT NULL`).all() as any[];

// Deployed weights
const W: Record<string,number> = { organic:15, momentum:30, graduation:12, devReputation:12, smartMoney:18, social:8, hype:5 };

// Live behavior: dev/smart are DROPPED (confidence 0). So blend = renormalized over {organic,momentum,graduation,social,hype}.
const live = ["organic","momentum","graduation","social","hype"];
function blend(scores: any, keys: string[]) {
  let sum=0, w=0;
  for (const k of keys){ if (typeof scores[k]==="number"){ sum+=scores[k]*W[k]; w+=W[k]; } }
  return w>0? sum/w : 0;
}
// Naive 7-facet blend that INCLUDES the frozen 50/60 constants (the strawman)
const all7 = ["organic","momentum","graduation","devReputation","smartMoney","social","hype"];

let nAt59=0, rawAbove59=0, sumRaw=0;
let liveVs7Diff=0, maxDiff=0;
for (const r of rows){
  const s = JSON.parse(r.scores);
  const bLive = blend(s, live);          // experiment's proposed re-normalized blend == current live blend
  const b7 = blend(s, all7);             // strawman: includes constants
  const d = Math.abs(bLive - b7);
  liveVs7Diff += d; maxDiff = Math.max(maxDiff, d);
  if (r.conviction===59){ nAt59++; sumRaw+=bLive; if (bLive>59.5) rawAbove59++; }
}
console.log(`BUYs n=${rows.length}`);
console.log(`Mean |liveBlend - naive7Blend| = ${(liveVs7Diff/rows.length).toFixed(2)} ; max = ${maxDiff.toFixed(2)}`);
console.log(`\nAmong BUYs at conviction==59 (n=${nAt59}):`);
console.log(`  mean raw live-blend (uncapped) = ${(sumRaw/nAt59).toFixed(1)}`);
console.log(`  count whose raw live-blend > 59.5 (i.e. were CAPPED down to 59) = ${rawAbove59} (${(100*rawAbove59/nAt59).toFixed(1)}%)`);

db.close();
