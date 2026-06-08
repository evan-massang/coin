import Database from "better-sqlite3";
import path from "path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const one = (s:string,...p:any[])=>db.prepare(s).get(...p) as any;
const all = (s:string,...p:any[])=>db.prepare(s).all(...p) as any[];

console.log("setting_change_log by 'by':");
for (const r of all(`SELECT "by", COUNT(*) c FROM setting_change_log GROUP BY "by"`)) console.log("  ",r.by,r.c);

for (const r of all(`SELECT * FROM learning_suggestions`)) console.log("  sug:", JSON.stringify(r));

const lf = one(`SELECT COUNT(*) c, MIN(at) mn, MAX(at) mx FROM learning_features`);
console.log("learning_features:", lf.c, lf.mn?new Date(lf.mn).toISOString():null, lf.mx?new Date(lf.mx).toISOString():null);
