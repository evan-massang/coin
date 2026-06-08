import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

// schema dump
function cols(t: string){ try { return (db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(c=>c.name).join(","); } catch(e:any){ return "ERR "+e.message; } }
for (const t of ["tokens","wallets","learning_features","signals"]) console.log(t+":", cols(t));

// copy wallets (smartMoney source)
try { const w = db.prepare("SELECT kind, COUNT(*) n FROM wallets GROUP BY kind").all(); console.log("WALLETS by kind:", JSON.stringify(w)); }
catch(e:any){ console.log("wallets err", e.message); }

// tokens snapshot sample - does it carry priceChange?
try {
  const tk = db.prepare("SELECT * FROM tokens WHERE last_snapshot IS NOT NULL LIMIT 1").get() as any;
  console.log("TOKEN row keys:", tk?Object.keys(tk).join(","):"none");
  if (tk?.last_snapshot) console.log("SNAPSHOT sample:", String(tk.last_snapshot).slice(0,400));
} catch(e:any){ console.log("tokens snap err", e.message); }
