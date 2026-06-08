import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

function safeCols(t: string) {
  try { return (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name); } catch { return ["<none>"]; }
}
for (const t of ["learning_suggestions", "setting_change_log"]) {
  console.log(`\n== ${t} ==`);
  console.log("cols:", safeCols(t).join(","));
  try {
    const n = (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c;
    console.log("rows:", n);
    const rows = db.prepare(`SELECT * FROM ${t} LIMIT 6`).all();
    console.log(JSON.stringify(rows).slice(0, 1800));
  } catch (e: any) { console.log("err", e.message); }
}
db.close();
