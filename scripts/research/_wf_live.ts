import Database from 'better-sqlite3';
const db = new Database('data/sniper.sqlite', { readonly: true, fileMustExist: true });
const c = db.prepare(`SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')`).get() as any;
const c15 = db.prepare(`SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND price_at_alert>0 AND price_15m IS NOT NULL`).get() as any;
const c5 = db.prepare(`SELECT COUNT(*) n FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND price_at_alert>0 AND price_5m IS NOT NULL`).get() as any;
const latest = db.prepare(`SELECT MAX(at) m FROM signals`).get() as any;
console.log('traded total:', c.n, '| have5m:', c5.n, '| have15m:', c15.n, '| latest at(ms):', latest.m, '=', new Date(latest.m).toISOString());
db.close();
