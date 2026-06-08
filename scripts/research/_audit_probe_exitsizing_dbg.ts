import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

const st = db.prepare("SELECT DISTINCT status FROM paper_positions").all() as any[];
console.log("distinct status raw:", st.map((r) => JSON.stringify(r.status)));

const p0 = db.prepare("SELECT id,mint,status,source FROM paper_positions LIMIT 3").all();
console.log("sample positions:", p0);

const t0 = db.prepare("SELECT mint,side,reason FROM paper_trades LIMIT 3").all();
console.log("sample trades:", t0);

// intersection of mints
const posMints = new Set((db.prepare("SELECT DISTINCT mint FROM paper_positions").all() as any[]).map((r) => r.mint));
const trdMints = new Set((db.prepare("SELECT DISTINCT mint FROM paper_trades").all() as any[]).map((r) => r.mint));
let inter = 0;
for (const m of trdMints) if (posMints.has(m)) inter++;
console.log(`posMints=${posMints.size} trdMints=${trdMints.size} intersect=${inter}`);

// source distribution
console.log("source dist:", db.prepare("SELECT source, status, COUNT(*) n FROM paper_positions GROUP BY source, status").all());
db.close();
