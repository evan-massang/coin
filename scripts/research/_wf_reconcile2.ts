import Database from 'better-sqlite3';
const db = new Database('data/sniper.sqlite', { readonly: true, fileMustExist: true });
type Row = { price_at_alert:number|null; price_15m:number|null };
const rows = db.prepare(`SELECT price_at_alert, price_15m FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG')`).all() as Row[];
// sweep filter: price_at_alert>0 AND price_15m != null
const a = rows.filter(r=>r.price_at_alert!=null&&r.price_at_alert>0&&r.price_15m!=null);
// reconcile filter: same
console.log('rows total:', rows.length);
console.log('entry>0 & p15 not null:', a.length);
console.log('entry==0 cases with p15:', rows.filter(r=>r.price_at_alert===0&&r.price_15m!=null).length);
console.log('entry null cases with p15:', rows.filter(r=>r.price_at_alert==null&&r.price_15m!=null).length);
// show the exact-zero return rows
const z = a.filter(r=> (r.price_15m! - r.price_at_alert!)===0);
console.log('exact-zero-return rows (p15==entry):', z.length);
console.log(z.slice(0,12).map(r=>`entry=${r.price_at_alert} p15=${r.price_15m}`).join('\n'));
db.close();
