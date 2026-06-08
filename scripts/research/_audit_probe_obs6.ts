import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
// scored = safety>0 (got facets). blind = organic==50 && momentum==50
const scored = db.prepare("SELECT verdict, json_extract(scores,'$.organic') o, json_extract(scores,'$.momentum') m FROM signals WHERE json_extract(scores,'$.safety')>0").all() as any[];
let blind=0,conf=0; const blindV:Record<string,number>={};
for(const r of scored){ if(r.o===50&&r.m===50){blind++; blindV[r.verdict]=(blindV[r.verdict]||0)+1;} else conf++; }
console.log(`SCORED=${scored.length} dex-confident=${conf} (${(100*conf/scored.length).toFixed(1)}%) blind50/50=${blind} (${(100*blind/scored.length).toFixed(1)}%)`);
console.log(`blind verdict breakdown:`, JSON.stringify(blindV));
// how many distinct mints ever scored more than once (rescan)?
const multi = db.prepare("SELECT mint, COUNT(*) c FROM signals WHERE json_extract(scores,'$.safety')>0 GROUP BY mint HAVING c>1").all() as any[];
console.log(`mints scored >1 time: ${multi.length}; example counts:`, multi.slice(0,5).map(r=>r.c));
