// Does attention predict outcomes? Correlates each resolved BUY signal's attention
// score with its realized forward path (max_gain_pct), so we can answer the only
// question that matters: do attention-informed buys actually do better?
//
//   npx tsx scripts/research/_attention_outcome.ts
//
// Read-only: opens the live DB in readonly mode (WAL lets it run alongside the engine).
import Database from "better-sqlite3";
import path from "node:path";

const dbPath = path.resolve(process.env.DATA_DIR ?? "data", "sniper.sqlite");
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

interface Row { scores: string; max_gain_pct: number; max_drawdown_pct: number | null; verdict: string }
const rows = db
  .prepare(
    `SELECT scores, max_gain_pct, max_drawdown_pct, verdict FROM signals
     WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL`,
  )
  .all() as Row[];

const pts = rows.map((r) => {
  let attention = 0;
  try { attention = (JSON.parse(r.scores) as { attention?: number }).attention ?? 0; } catch { /* default 0 */ }
  return { attention, gain: r.max_gain_pct, draw: r.max_drawdown_pct ?? 0 };
});

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const summarize = (label: string, group: typeof pts): void => {
  if (!group.length) { console.log(`  ${label.padEnd(18)} n=0`); return; }
  const gains = group.map((g) => g.gain);
  const wins = group.filter((g) => g.gain >= 100).length; // >=2x = "win"
  const avg = gains.reduce((a, b) => a + b, 0) / gains.length;
  console.log(
    `  ${label.padEnd(18)} n=${String(group.length).padStart(4)}  win%(>=2x)=${((wins / group.length) * 100).toFixed(1).padStart(5)}  ` +
    `avgMaxGain=${avg.toFixed(1).padStart(7)}%  medMaxGain=${median(gains).toFixed(1).padStart(6)}%  avgDraw=${(group.reduce((a, b) => a + b.draw, 0) / group.length).toFixed(1)}%`,
  );
};

console.log(`\nAttention → outcome on ${pts.length} resolved BUY signals (DB: ${dbPath})\n`);
console.log("By attention presence:");
summarize("no attention (0)", pts.filter((p) => p.attention <= 0));
summarize("attention > 0", pts.filter((p) => p.attention > 0));

console.log("\nBy attention band:");
summarize("0", pts.filter((p) => p.attention <= 0));
summarize("1-40 (weak)", pts.filter((p) => p.attention > 0 && p.attention < 40));
summarize("40-60 (mid)", pts.filter((p) => p.attention >= 40 && p.attention < 60));
summarize("60-80 (strong)", pts.filter((p) => p.attention >= 60 && p.attention < 80));
summarize("80+ (very strong)", pts.filter((p) => p.attention >= 80));

const withA = pts.filter((p) => p.attention > 0);
if (withA.length >= 8) {
  // Simple Pearson correlation between attention and max gain.
  const n = withA.length;
  const mx = withA.reduce((a, b) => a + b.attention, 0) / n;
  const my = withA.reduce((a, b) => a + b.gain, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of withA) { const dx = p.attention - mx, dy = p.gain - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const corr = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  console.log(`\nPearson r(attention, maxGain) over ${n} attention-scored buys: ${corr.toFixed(3)}`);
} else {
  console.log(`\n(only ${withA.length} attention-scored resolved buys — need more for a correlation; let it run)`);
}
db.close();
