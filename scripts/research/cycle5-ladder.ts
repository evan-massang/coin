/**
 * Cycle 5 exit experiment (READ-ONLY): selection is a coin-flip on free data
 * (no facet separates winners from losers), so the edge must come from CAPTURE.
 * Winners cluster at 2.0-2.5x. Does front-loading the profit ladder (trim more
 * at 2x) capture more total PnL on the real traded history?
 *
 * Faithful: a rung fires iff peak >= its multiple (order-independent for "was
 * this level touched"). Trailing stop is held FIXED at 0.35 so we isolate the
 * ladder-allocation effect (varying trailing would bias losers via the model).
 *   tsx scripts/research/cycle5-ladder.ts
 */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const J = (v: unknown): Record<string, number> => { try { return JSON.parse(String(v)); } catch { return {}; } };

// Traded + resolved.
const rows = db.prepare(
  "SELECT symbol, scores, max_gain_pct, real_pnl_sol FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL",
).all() as Array<Record<string, unknown>>;

type Rung = { multiple: number; sellPct: number };
function capture(peakMultiple: number, ladder: Rung[], trailing = 0.35): number {
  let captured = 0, remaining = 1;
  for (const r of ladder) {
    if (peakMultiple >= r.multiple) { captured += r.sellPct * r.multiple; remaining -= r.sellPct; }
  }
  captured += remaining * Math.max(0, peakMultiple) * (1 - trailing);
  return captured;
}

const ladders: Record<string, Rung[]> = {
  "current 40/30/20": [{ multiple: 2, sellPct: 0.4 }, { multiple: 3, sellPct: 0.3 }, { multiple: 5, sellPct: 0.2 }],
  "front  60/25/15": [{ multiple: 2, sellPct: 0.6 }, { multiple: 3, sellPct: 0.25 }, { multiple: 5, sellPct: 0.15 }],
  "front  70/20/10": [{ multiple: 2, sellPct: 0.7 }, { multiple: 3, sellPct: 0.2 }, { multiple: 5, sellPct: 0.1 }],
  "early  50@1.5x ..": [{ multiple: 1.5, sellPct: 0.5 }, { multiple: 3, sellPct: 0.3 }, { multiple: 5, sellPct: 0.2 }],
  "all-out 100@2x": [{ multiple: 2, sellPct: 1.0 }],
};

const out: string[] = []; const p = (s = "") => out.push(s);
p(`# CYCLE 5 — LADDER ALLOCATION SWEEP (traded+resolved=${rows.length}, trailing fixed 0.35)`);
const peaks = rows.map((r) => 1 + num(r.max_gain_pct) / 100);
p(`peak-multiple distribution: >=1.5x=${peaks.filter((m) => m >= 1.5).length}  >=2x=${peaks.filter((m) => m >= 2).length}  >=3x=${peaks.filter((m) => m >= 3).length}  >=5x=${peaks.filter((m) => m >= 5).length}`);
p("");
p(`ladder            | pnl/notional | win% (capture>1) | avg-capture-on-2x+`);
for (const [name, ladder] of Object.entries(ladders)) {
  let pnl = 0, wins = 0; const big: number[] = [];
  for (const m of peaks) {
    const c = capture(m, ladder);
    pnl += c - 1;
    if (c > 1) wins++;
    if (m >= 2) big.push(c);
  }
  const avgBig = big.length ? big.reduce((a, b) => a + b, 0) / big.length : 0;
  p(`${name.padEnd(18)}| ${pnl.toFixed(2).padStart(12)} | ${((wins / peaks.length) * 100).toFixed(1).padStart(16)} | ${avgBig.toFixed(2).padStart(18)}`);
}
p("");
p(`(pnl is summed over ALL ${rows.length} trades at 1-SOL notional each; less negative = better.`);
p(` losers are identical across ladders -- only the 2x+ winners differ, so this isolates capture.)`);

// eslint-disable-next-line no-console
console.log(out.join("\n"));
db.close();
