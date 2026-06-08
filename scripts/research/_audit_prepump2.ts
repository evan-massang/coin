/**
 * AUDIT Finding 7 — follow-up (READ-ONLY). Two questions the first pass raised:
 *  (1) In the TRADED set, the only features with AUC>0.6 were momentum & graduation,
 *      but graduation is ~constant (4 vs 3.7) and momentum's tercile lift is
 *      NON-MONOTONE (hi=11.6% but mid<lo). Is momentum a real, usable gate on the
 *      traded set, or an artifact of a tiny top bucket (22 winners total)?
 *  (2) Quantify the BEST realizable free-feed gate: for each candidate threshold on
 *      momentum / txns5m, what is the resulting traded-count and winner-rate vs the
 *      6.5% base rate? A pre-pump signal is only "real" if some threshold meaningfully
 *      beats base rate while keeping enough trades.
 * Also: re-check on the CLEAN multi-horizon subset (price_5m != price_15m) to rule out
 * the known backfill artifact.
 *   npx tsx scripts/research/_audit_prepump2.ts
 */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const J = (v: unknown): Record<string, number> => { try { return JSON.parse(String(v)); } catch { return {}; } };
const A = (v: unknown): string[] => { try { const x = JSON.parse(String(v)); return Array.isArray(x) ? x.map(String) : []; } catch { return []; } };
const out: string[] = []; const p = (s = "") => out.push(s);
type Row = Record<string, unknown>;
const isWin = (r: Row) => num(r.max_gain_pct) >= 100;
function dexTxns(r: Row): number { for (const l of A(r.reasons)) { const m = l.match(/dex:\s*([0-9.]+)\s*txns\/5m/i); if (m) return Number(m[1]); } return NaN; }

const traded = db.prepare(
  "SELECT symbol, conviction, scores, reasons, max_gain_pct, max_drawdown_pct, price_5m, price_15m FROM signals " +
  "WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL",
).all() as Row[];

p("AUDIT 7 follow-up — is the momentum/txns5m edge a USABLE pre-pump gate on TRADED BUYs?");
const base = 100 * traded.filter(isWin).length / traded.length;
p(`traded resolved=${traded.length}  base winner-rate=${base.toFixed(1)}%\n`);

function gateScan(name: string, valOf: (r: Row) => number, thresholds: number[]) {
  p(`# gate: ${name} >= T`);
  p(`   T  | trades(keep) | winners | win% | lift_vs_base | losersAvoided`);
  const total = traded.length, totalWin = traded.filter(isWin).length;
  for (const T of thresholds) {
    const kept = traded.filter((r) => Number.isFinite(valOf(r)) && valOf(r) >= T);
    const w = kept.filter(isWin).length;
    const wr = kept.length ? 100 * w / kept.length : NaN;
    const losersAvoided = (total - kept.length) - (totalWin - w); // losers removed by the gate
    p(`  ${String(T).padStart(3)} | ${String(kept.length).padStart(11)} | ${String(w).padStart(7)} | ${(Number.isFinite(wr) ? wr.toFixed(1) : "-").padStart(4)} | ${(Number.isFinite(wr) ? (wr / base).toFixed(2) + "x" : "-").padStart(11)} | ${String(losersAvoided).padStart(13)}`);
  }
  p("");
}

gateScan("score.momentum", (r) => num(J(r.scores).momentum), [70, 75, 80, 83, 85, 88]);
gateScan("dex.txns5m", (r) => dexTxns(r), [50, 100, 150, 200, 300]);

// combined gate: high momentum AND high txns
p("# combined gate: momentum>=83 AND txns5m>=150");
{
  const kept = traded.filter((r) => num(J(r.scores).momentum) >= 83 && dexTxns(r) >= 150);
  const w = kept.filter(isWin).length;
  p(`  kept=${kept.length}  winners=${w}  win%=${kept.length ? (100 * w / kept.length).toFixed(1) : "-"}  (base ${base.toFixed(1)}%)`);
}

// CLEAN multi-horizon subset (rule out price_5m==price_15m backfill artifact)
const clean = traded.filter((r) => num(r.price_5m) !== num(r.price_15m) && Number.isFinite(num(r.price_5m)) && Number.isFinite(num(r.price_15m)));
p(`\n# CLEAN subset (price_5m != price_15m): ${clean.length}/${traded.length} rows`);
if (clean.length >= 10) {
  const cw = clean.filter(isWin);
  p(`  winners=${cw.length} (${(100 * cw.length / clean.length).toFixed(1)}%)`);
  const mW = cw.map((r) => num(J(r.scores).momentum)).filter(Number.isFinite);
  const cl = clean.filter((r) => !isWin(r));
  const mL = cl.map((r) => num(J(r.scores).momentum)).filter(Number.isFinite);
  const mean = (x: number[]) => x.length ? (x.reduce((a, b) => a + b, 0) / x.length) : NaN;
  p(`  momentum mean winners=${mean(mW).toFixed(1)} losers=${mean(mL).toFixed(1)}`);
  const tW = cw.map(dexTxns).filter(Number.isFinite), tL = cl.map(dexTxns).filter(Number.isFinite);
  p(`  txns5m   mean winners=${mean(tW).toFixed(1)} losers=${mean(tL).toFixed(1)}`);
}

// How many DISTINCT momentum values exist among traded? (separation can be illusory if it's near-constant)
const moms = traded.map((r) => num(J(r.scores).momentum)).filter(Number.isFinite);
const uniq = [...new Set(moms)].sort((a, b) => a - b);
p(`\n# momentum distribution among traded: ${uniq.length} distinct values, range ${uniq[0]}..${uniq[uniq.length - 1]}`);
const hist: Record<string, number> = {};
for (const m of moms) { const b = `${Math.floor(m / 5) * 5}-${Math.floor(m / 5) * 5 + 4}`; hist[b] = (hist[b] ?? 0) + 1; }
p("  " + Object.entries(hist).sort((a, b) => Number(a[0].split("-")[0]) - Number(b[0].split("-")[0])).map(([k, v]) => `${k}:${v}`).join("  "));

// eslint-disable-next-line no-console
console.log(out.join("\n"));
db.close();
