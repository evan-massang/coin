import Database from 'better-sqlite3';
const db = new Database('data/sniper.sqlite', { readonly: true, fileMustExist: true });

// schema of signals
const cols = db.prepare("PRAGMA table_info(signals)").all() as any[];
console.log('=== signals columns ===');
for (const c of cols) console.log(`${c.name}\t${c.type}`);

console.log('\n=== verdict distribution ===');
const v = db.prepare("SELECT verdict, COUNT(*) n FROM signals GROUP BY verdict ORDER BY n DESC").all();
console.log(v);

const total = db.prepare("SELECT COUNT(*) n FROM signals").get() as any;
console.log('\ntotal signals:', total.n);

// traded set
const traded = db.prepare("SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')").get() as any;
console.log('traded (BUY_SMALL/BUY_STRONG):', traded.n);

// how many traded have each price horizon
for (const h of ['price_5m','price_15m','price_1h']) {
  const r = db.prepare(`SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND price_at_alert>0 AND ${h} IS NOT NULL`).get() as any;
  console.log(`traded with ${h} & price_at_alert>0:`, r.n);
}

// presence of max_gain/drawdown/pnl among traded
const g = db.prepare("SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL").get() as any;
console.log('traded with max_gain_pct:', g.n);
const dd = db.prepare("SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_drawdown_pct IS NOT NULL").get() as any;
console.log('traded with max_drawdown_pct:', dd.n);
const pnl = db.prepare("SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND real_pnl_sol IS NOT NULL").get() as any;
console.log('traded with real_pnl_sol:', pnl.n);
