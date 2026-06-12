// Read-only probe: which horizon actually supplies `finalMult` in the sweep's
// usable rows, and how does mean final return differ by horizon? If "final" is
// mostly the 5m price, hold-to-final results are really hold-for-5-minutes.
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const rows = db.prepare(`
  SELECT price_at_alert base, price_5m p5, price_15m p15, price_1h p1h, max_gain_pct g, max_drawdown_pct dd
  FROM signals
  WHERE verdict LIKE 'BUY%' AND price_at_alert > 0 AND max_gain_pct IS NOT NULL AND max_drawdown_pct IS NOT NULL
    AND COALESCE(price_1h, price_15m, price_5m) IS NOT NULL
`).all();

const groups = { "1h": [], "15m": [], "5m": [] };
for (const r of rows) {
  const horizon = r.p1h != null ? "1h" : r.p15 != null ? "15m" : "5m";
  groups[horizon].push((r.p1h ?? r.p15 ?? r.p5) / r.base - 1);
}
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
for (const [h, v] of Object.entries(groups)) {
  console.log(`final from ${h}: n=${v.length} (${((100 * v.length) / rows.length).toFixed(1)}%)  mean=${(100 * mean(v)).toFixed(1)}%  median=${(100 * med(v)).toFixed(1)}%`);
}

// Of the rows that DO have a 1h price, what does the 5m price say? (decay 5m→1h)
const both = rows.filter((r) => r.p1h != null && r.p5 != null);
const d5 = both.map((r) => r.p5 / r.base - 1);
const d1h = both.map((r) => r.p1h / r.base - 1);
console.log(`\nrows with BOTH 5m and 1h: n=${both.length}`);
console.log(`  mean@5m=${(100 * mean(d5)).toFixed(1)}%  median@5m=${(100 * med(d5)).toFixed(1)}%`);
console.log(`  mean@1h=${(100 * mean(d1h)).toFixed(1)}%  median@1h=${(100 * med(d1h)).toFixed(1)}%`);
