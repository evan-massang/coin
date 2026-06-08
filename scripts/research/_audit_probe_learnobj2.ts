import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const all = (sql: string, ...a: any[]) => { try { return db.prepare(sql).all(...a) as any[]; } catch (e:any){ return [{err:e.message}]; } };

// live learningMode setting
console.log("settings rows mentioning learning/tune:");
for (const r of all("SELECT key, value FROM settings WHERE key LIKE '%learning%' OR key LIKE '%tune%' OR key LIKE '%organic%'")) console.log("  ", r.key, "=", r.value);

// suggestions: have any been APPLIED (auto-tune) vs pending/manual?
console.log("\nlearning_suggestions by status:");
for (const r of all("SELECT status, COUNT(*) n FROM learning_suggestions GROUP BY status")) console.log("  ", r.status, r.n);
console.log("\nlearning_suggestions by setting+status:");
for (const r of all("SELECT setting, status, COUNT(*) n FROM learning_suggestions GROUP BY setting, status ORDER BY n DESC")) console.log("  ", r.setting, r.status, r.n);

// setting_change_log: any auto-applied changes?
console.log("\nsetting_change_log by 'by':");
for (const r of all("SELECT by, COUNT(*) n FROM setting_change_log GROUP BY by")) console.log("  ", r.by, r.n);
console.log("\nrecent setting changes (any):");
for (const r of all("SELECT * FROM setting_change_log ORDER BY at DESC LIMIT 10")) console.log("  ", JSON.stringify(r));

db.close();
