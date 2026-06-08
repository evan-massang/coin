import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const one = (sql:string,...a:any[])=>db.prepare(sql).get(...a) as any;
const all = (sql:string,...a:any[])=>db.prepare(sql).all(...a) as any[];

// distinct mints
console.log("distinct mints in positions=", one("SELECT COUNT(DISTINCT mint) n FROM paper_positions").n,
            " in trades=", one("SELECT COUNT(DISTINCT mint) n FROM paper_trades").n,
            " buys=", one("SELECT COUNT(*) n FROM paper_trades WHERE side='buy'").n);

// OVERSELL: per mint sum buy tokens vs sum sell tokens
const bySide = all(`SELECT mint,
  SUM(CASE WHEN side='buy' THEN token_amount ELSE 0 END) bt,
  SUM(CASE WHEN side='sell' THEN token_amount ELSE 0 END) st,
  SUM(CASE WHEN side='sell' THEN 1 ELSE 0 END) nsell,
  SUM(CASE WHEN side='buy' THEN 1 ELSE 0 END) nbuy
  FROM paper_trades GROUP BY mint`);
const oversold = bySide.filter(r=> r.st > r.bt * 1.0000001);
console.log("mints oversold (sell tokens > buy tokens):", oversold.length);
oversold.slice(0,5).forEach(r=>console.log("  oversold", r.mint.slice(0,8), "buy="+r.bt.toExponential(3), "sell="+r.st.toExponential(3), "ratio="+(r.st/r.bt).toFixed(4), "nsell="+r.nsell));

// negative remaining_token_amount in any fill
console.log("fills with negative remaining_token_amount:", one("SELECT COUNT(*) n FROM paper_trades WHERE remaining_token_amount < 0").n);

// CLOSED/PARTIAL positions: reconcile realized_pnl_usd sign vs sum of sell realized_pnl_sol per mint
// Map each mint's trade realized (SOL) and compare sign to position realized_pnl_usd
const posReal = all("SELECT mint, status, realized_pnl_usd FROM paper_positions WHERE status IN ('CLOSED','PARTIAL')");
const tradeRealByMint = new Map<string,number>();
for(const r of all("SELECT mint, SUM(realized_pnl_sol) s FROM paper_trades WHERE side='sell' GROUP BY mint")) tradeRealByMint.set(r.mint, r.s);
let signMismatch=0, both=0;
for(const p of posReal){ const tr = tradeRealByMint.get(p.mint); if(tr===undefined) continue; both++; if(Math.sign(tr)!==Math.sign(p.realized_pnl_usd) && Math.abs(tr)>1e-9 && Math.abs(p.realized_pnl_usd)>1e-9) signMismatch++; }
console.log("CLOSED/PARTIAL reconciled with trades:", both, " realized sign mismatches (USD vs SOL):", signMismatch);

// TRUE mark-to-market of OPEN/PARTIAL right now
let unreal=0, deadCount=0, investedOpen=0;
const op = all("SELECT entry_price_usd e, last_price_usd l, sol_invested s, token_amount tk FROM paper_positions WHERE status IN ('OPEN','PARTIAL')");
for(const p of op){ investedOpen+=p.s; if(p.e>0 && p.l){ const u=(p.l/p.e-1)*p.s; unreal+=u; if(p.l/p.e < 0.5) deadCount++; } }
console.log("OPEN/PARTIAL: SOL still invested(cost basis)=", investedOpen.toFixed(4), " current unrealized SOL=", unreal.toFixed(4), " positions down >50%:", deadCount, "of", op.length);

// realized so far
const realized = one("SELECT COALESCE(SUM(realized_pnl_sol),0) s FROM paper_trades").s;
const wallet = one("SELECT * FROM paper_wallet");
console.log("realized SOL=", realized.toFixed(4), " | wallet balance=", wallet.balance_sol.toFixed(4), " start=", wallet.starting_balance_sol);
console.log("DASHBOARD totalPnl (realized+unrealized) =", (realized+unreal).toFixed(4), "SOL");
console.log("TRUE equity (balance + recoverable open value) =", (wallet.balance_sol + (investedOpen+unreal)).toFixed(4), " vs start", wallet.starting_balance_sol);
