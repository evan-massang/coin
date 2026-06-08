import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

function dist(label: string, fn: (s: any) => any) {
  const rows = db.prepare("SELECT scores FROM signals WHERE verdict LIKE 'BUY%' AND scores IS NOT NULL").all() as any[];
  const total = rows.length;
  const counts = new Map<string, number>();
  for (const r of rows) {
    let s: any;
    try { s = JSON.parse(r.scores); } catch { continue; }
    const v = fn(s);
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`\n[${label}] total BUYs=${total}`);
  for (const [k, c] of sorted) {
    console.log(`   ${k}: ${c} (${((c / total) * 100).toFixed(1)}%)`);
  }
}

// total BUY count
const totalBuys = (db.prepare("SELECT COUNT(*) c FROM signals WHERE verdict LIKE 'BUY%'").get() as any).c;
console.log("TOTAL BUYS (verdict LIKE BUY%):", totalBuys);

dist("devReputation", (s) => Math.round(s.devReputation ?? -1));
dist("smartMoney", (s) => Math.round(s.smartMoney ?? -1));
dist("graduation", (s) => Math.round(s.graduation ?? -1));
dist("social", (s) => Math.round(s.social ?? -1));
dist("hype", (s) => Math.round(s.hype ?? -1));
dist("organic", (s) => Math.round(s.organic ?? -1));
dist("momentum", (s) => Math.round(s.momentum ?? -1));

// Check what columns / tables exist for wallets
try {
  const tbls = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
  console.log("\nTABLES:", tbls.map((t) => t.name).join(", "));
} catch (e) { console.log("tbl err", e); }

// Look for a wallets-like table
const tableNames = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map((t) => t.name);
for (const tn of tableNames) {
  if (/wallet/i.test(tn)) {
    const cnt = (db.prepare(`SELECT COUNT(*) c FROM ${tn}`).get() as any).c;
    console.log(`WALLET TABLE ${tn}: rows=${cnt}`);
    try {
      const kinds = db.prepare(`SELECT kind, COUNT(*) c FROM ${tn} GROUP BY kind`).all() as any[];
      console.log("   kinds:", JSON.stringify(kinds));
    } catch {}
  }
}

db.close();
