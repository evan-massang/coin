import Database from "better-sqlite3";
import fs from "node:fs";
const db = new Database("data/sniper.sqlite", { readonly: true });
const exp = db.prepare("SELECT export_path FROM paper_resets ORDER BY at DESC LIMIT 1").get()?.export_path;
if (exp && fs.existsSync(exp)) {
  const st = fs.statSync(exp);
  const j = JSON.parse(fs.readFileSync(exp, "utf8"));
  console.log(`export OK: ${exp}`);
  console.log(`  size=${(st.size / 1024 / 1024).toFixed(1)}MB  open=${j.open.length} closed=${j.closed.length} fills=${j.fills.length} equity=${j.stats.equitySol.toFixed(2)}`);
} else console.log(`export MISSING: ${exp}`);
console.log("\nnew-generation fills (should carry position_id + flags):");
console.table(db.prepare("SELECT id, mint, side, sol_amount, reason, position_id, flags, at FROM paper_trades ORDER BY at DESC LIMIT 5").all()
  .map((f) => ({ ...f, mint: f.mint.slice(0, 8), at: new Date(f.at).toISOString().slice(11, 19) })));
console.log("open positions:");
console.table(db.prepare("SELECT id, mint, symbol, sol_invested, entry_at_ms FROM paper_positions WHERE status!='CLOSED'").all()
  .map((p) => ({ ...p, mint: p.mint.slice(0, 8), entry_at_ms: new Date(p.entry_at_ms).toISOString().slice(11, 19) })));
