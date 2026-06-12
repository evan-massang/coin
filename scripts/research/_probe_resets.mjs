import Database from "better-sqlite3";
const db = new Database("data/sniper.sqlite", { readonly: true });
console.log("paper_resets:", JSON.stringify(db.prepare("SELECT * FROM paper_resets").all(), null, 1));
console.log("wallet:", JSON.stringify(db.prepare("SELECT * FROM paper_wallet").get()));
console.log("journal rows:", db.prepare("SELECT COUNT(*) n FROM realized_trades").get().n);
console.log("open positions:", db.prepare("SELECT COUNT(*) n FROM paper_positions WHERE status!='CLOSED'").get().n);
console.log("closed positions:", db.prepare("SELECT COUNT(*) n FROM paper_positions WHERE status='CLOSED'").get().n);
console.log("fills:", db.prepare("SELECT COUNT(*) n FROM paper_trades").get().n);
