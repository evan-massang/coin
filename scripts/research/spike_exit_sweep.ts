/**
 * spike_exit_sweep.ts — does "sell everything on the first big spike" beat the
 * Cycle-8 early-harvest ladder on REALIZED PnL?
 *
 * Method: same outcome-bounds approach as exitOutcomeBounds / _audit_probe_stopsweep.
 * We only have path BOUNDS per signal (max_gain_pct, max_drawdown_pct, prices at
 * alert/5m/15m/1h), not tick ordering — so every strategy is scored under BOTH
 * orderings: OPTIMISTIC (spike happens before the trough) and PESSIMISTIC
 * (trough first — stop fires before any spike). A strategy only "wins" if it is
 * better on BOTH bounds (Pareto), matching the Cycle-8 ladder decision rule.
 *
 * Run:  npx tsx scripts/research/spike_exit_sweep.ts
 * Read-only. Decides whether to flip settings: exitStyle=firstSpike.
 */
import Database from "better-sqlite3";
import path from "node:path";

// ── Tunables (match live settings / cycle-8 evidence) ───────────────────────
const STOP = 0.4; // stopLossPct default
const GAP_FILL_MULT = 1 - 0.565; // pessimistic stop fill: cycle-8 median realized −56.5%
const CLEAN_FILL_MULT = 1 - STOP; // optimistic stop fill: exactly at the stop
const SELL_SLIP = 0.02; // haircut on every sell fill (spread/slippage)
const SPIKE_MULTIPLES = [1.3, 1.4, 1.5, 1.8, 2.0, 2.5, 3.0, 4.0, 5.0];
const RUNNERS = [0, 0.1];

type Row = {
  mint: string; verdict: string; conviction: number;
  price_at_alert: number | null; price_5m: number | null; price_15m: number | null; price_1h: number | null;
  max_gain_pct: number | null; max_drawdown_pct: number | null;
};

type Rung = { multiple: number; sellPct: number };
const EARLY_HARVEST: Rung[] = [
  { multiple: 1.4, sellPct: 0.3 },
  { multiple: 1.8, sellPct: 0.3 },
  { multiple: 2.5, sellPct: 0.2 },
  { multiple: 5, sellPct: 0.1 },
]; // 10% runner → exits at final/stop like the remainder

function firstSpike(multiple: number, keepRunnerPct: number): Rung[] {
  return [{ multiple, sellPct: 1 - keepRunnerPct }];
}

interface Bounds { maxMult: number; minMult: number; finalMult: number }

/** Realized PnL (per 1 unit) for a ladder under one ordering assumption. */
function simulate(ladder: Rung[], b: Bounds, troughFirst: boolean): number {
  let pnl = 0;
  let remaining = 1;

  if (troughFirst && b.minMult <= 1 - STOP) {
    // Trough comes first: the whole position stops out (gapped fill) before any spike.
    return GAP_FILL_MULT - 1;
  }

  // Spike leg: rungs the path reached fill at their multiple (minus slip).
  for (const r of ladder) {
    if (b.maxMult >= r.multiple && remaining > 0) {
      const frac = Math.min(r.sellPct, remaining);
      pnl += frac * (r.multiple * (1 - SELL_SLIP) - 1);
      remaining -= frac;
    }
  }

  if (remaining > 0) {
    if (b.minMult <= 1 - STOP) {
      // Drawdown after the spike: the remainder stops out (clean fill — we were watching).
      pnl += remaining * (CLEAN_FILL_MULT - 1);
    } else {
      // Neither stopped nor fully laddered: remainder exits at the final proxy (time stop).
      pnl += remaining * (b.finalMult * (1 - SELL_SLIP) - 1);
    }
  }
  return pnl;
}

function stats(pnls: number[]) {
  const n = pnls.length;
  const wins = pnls.filter((x) => x > 0);
  const losses = pnls.filter((x) => x <= 0);
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
  const grossW = sum(wins);
  const grossL = Math.abs(sum(losses));
  return {
    n,
    winRate: n ? (100 * wins.length) / n : 0,
    meanPct: n ? (100 * sum(pnls)) / n : 0,
    profitFactor: grossL > 0 ? grossW / grossL : Infinity,
    totalUnits: sum(pnls),
  };
}

// ── Load recorded BUY signals ────────────────────────────────────────────────
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const rows = db
  .prepare(
    `SELECT mint, verdict, conviction, price_at_alert, price_5m, price_15m, price_1h, max_gain_pct, max_drawdown_pct
     FROM signals WHERE verdict LIKE 'BUY%'`,
  )
  .all() as Row[];

const usable: Bounds[] = [];
for (const r of rows) {
  const base = r.price_at_alert;
  if (base == null || base <= 0 || r.max_gain_pct == null || r.max_drawdown_pct == null) continue;
  const fin = r.price_1h ?? r.price_15m ?? r.price_5m;
  if (fin == null) continue;
  // VERIFIED CONVENTION (featureStore.ts:83, probed live 2026-06-12): max_gain_pct
  // is entry-relative and ≥0; max_drawdown_pct is a PEAK-relative positive
  // magnitude ((peak−trough)/peak, trough initialized at the alert price). The
  // entry-relative trough is therefore exactly peakMult·(1−dd) — an identity,
  // independent of path order. The original `1 + dd/100` mapping put the trough
  // ABOVE entry, so the stop never fired and both bounds collapsed to one number.
  const maxMult = 1 + r.max_gain_pct / 100;
  usable.push({
    maxMult,
    minMult: maxMult * (1 - r.max_drawdown_pct / 100),
    finalMult: fin / base,
  });
}
const stopBreaches = usable.filter((b) => b.minMult <= 1 - STOP).length;
console.log(`BUY signals: ${rows.length}  usable (bounds + final): ${usable.length}`);
console.log(`stop=${STOP}  gapFill=${((GAP_FILL_MULT - 1) * 100).toFixed(1)}%  slip=${SELL_SLIP * 100}%  stop-breach rows=${stopBreaches} (${((100 * stopBreaches) / usable.length).toFixed(1)}%)\n`);

// ── Sweep ────────────────────────────────────────────────────────────────────
const strategies: Array<{ name: string; ladder: Rung[] }> = [
  { name: "BASELINE early-harvest", ladder: EARLY_HARVEST },
  // Control: no harvest at all — stop + hold-to-final only. If this "wins", the
  // sim is telling us laddering is net-negative under these fill assumptions,
  // not that any particular spike multiple is special.
  { name: "CONTROL no-ladder (stop+final)", ladder: [] },
];
for (const m of SPIKE_MULTIPLES)
  for (const k of RUNNERS) strategies.push({ name: `firstSpike ${m}x runner=${k * 100}%`, ladder: firstSpike(m, k) });

const fmt = (s: ReturnType<typeof stats>) =>
  `win%=${s.winRate.toFixed(1).padStart(5)} mean=${s.meanPct.toFixed(2).padStart(7)}% PF=${
    Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2).padStart(5) : "  inf"
  } total=${s.totalUnits.toFixed(1).padStart(8)}u`;

let baseOpt = 0;
let basePess = 0;
for (const strat of strategies) {
  const opt = stats(usable.map((b) => simulate(strat.ladder, b, false)));
  const pess = stats(usable.map((b) => simulate(strat.ladder, b, true)));
  if (strat.name.startsWith("BASELINE")) {
    baseOpt = opt.meanPct;
    basePess = pess.meanPct;
  }
  const pareto = opt.meanPct > baseOpt && pess.meanPct > basePess ? "  ← BEATS BASELINE (both bounds)" : "";
  console.log(strat.name.padEnd(30));
  console.log(`  optimistic : ${fmt(opt)}`);
  console.log(`  pessimistic: ${fmt(pess)}${pareto}\n`);
}

console.log(
  "Decision rule: flip exitStyle=firstSpike ONLY for a config that beats the baseline\n" +
    "mean realized PnL on BOTH orderings. If nothing does, the spike idea stays off —\n" +
    "same rule that rejected 'exit-if-red-at-15m'. Re-run after entry fixes land:\n" +
    "better entries change which exits win.",
);
