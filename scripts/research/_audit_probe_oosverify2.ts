import Database from "better-sqlite3";
import path from "path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const one = (s:string,...p:any[])=>db.prepare(s).get(...p) as any;
const all = (s:string,...p:any[])=>db.prepare(s).all(...p) as any[];

// schema of setting_change_log
console.log("setting_change_log cols:", all(`PRAGMA table_info(setting_change_log)`).map(r=>r.name).join(","));
console.log("by source:");
for (const r of all(`SELECT source, COUNT(*) c FROM setting_change_log GROUP BY source`)) console.log("  ",r.source,r.c);

// learning_suggestions status
console.log("suggestions cols:", all(`PRAGMA table_info(learning_suggestions)`).map(r=>r.name).join(","));
for (const r of all(`SELECT * FROM learning_suggestions`)) console.log("  sug:", JSON.stringify(r));

// learning_features count + span
const lf = one(`SELECT COUNT(*) c, MIN(at) mn, MAX(at) mx FROM learning_features`);
console.log("learning_features:", lf.c, lf.mn?new Date(lf.mn).toISOString():null, lf.mx?new Date(lf.mx).toISOString():null);
