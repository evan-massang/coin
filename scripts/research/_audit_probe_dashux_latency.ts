import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const cols = (t:string)=> (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(c=>c.name);
console.log("tokens cols:", cols("tokens").join(", "));
console.log("signals cols:", cols("signals").join(", "));
// is there a token birth/first_seen we could join to compute latency?
const tcand = cols("tokens").filter(c=>/birth|first|seen|created|disc|at_ms|snapshot/i.test(c));
console.log("tokens latency-candidate cols:", tcand.join(", ") || "(none)");
// sample last_snapshot to see if it carries a birth/createdAt
try {
  const r = db.prepare("SELECT mint, last_snapshot FROM tokens WHERE last_snapshot IS NOT NULL LIMIT 1").get() as any;
  if (r) { const snap = JSON.parse(r.last_snapshot); console.log("last_snapshot keys:", Object.keys(snap).join(", ")); 
    console.log("  has pairCreatedAt/createdAt?:", ["pairCreatedAt","createdAt","firstSeen","birth"].filter(k=>k in snap || (snap.pair&&k in snap.pair)).join(",")||"(none)"); }
} catch(e){ console.log("snapshot parse err", String(e)); }
// Can we compute latency from signals alone? signal.at vs token discovery. Check if signals has a created/birth field beyond 'at'
const scand = cols("signals").filter(c=>/birth|first|seen|created|disc/i.test(c));
console.log("signals discovery-candidate cols:", scand.join(", ") || "(none)");
// paper_positions: entry_at_ms exists; is there any first-seen to diff against?
console.log("paper_positions cols:", cols("paper_positions").join(", "));
db.close();
