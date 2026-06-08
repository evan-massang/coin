/**
 * AUDIT 7 — significance check (READ-ONLY). The momentum>=85 gate showed 14.3% win
 * (10/70) vs 6.5% base. With only 22 winners total, is that lift real or luck?
 * Permutation test: shuffle the winner labels 20000x, recompute the win-rate among
 * the top-70-by-momentum, and see how often we match/beat the observed 10 winners.
 * Also a one-sided hypergeometric-style p via the same permutation. Repeat for the
 * combined gate. p<0.05 => unlikely to be noise.
 *   npx tsx scripts/research/_audit_prepump3.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const J = (v: unknown): Record<string, number> => { try { return JSON.parse(String(v)); } catch { return {}; } };
const A = (v: unknown): string[] => { try { const x = JSON.parse(String(v)); return Array.isArray(x) ? x.map(String) : []; } catch { return []; } };
type Row = Record<string, unknown>;
const isWin = (r: Row) => num(r.max_gain_pct) >= 100;
function dexTxns(r: Row): number { for (const l of A(r.reasons)) { const m = l.match(/dex:\s*([0-9.]+)\s*txns\/5m/i); if (m) return Number(m[1]); } return NaN; }
const out: string[] = []; const p = (s = "") => out.push(s);

const traded = db.prepare(
  "SELECT scores, reasons, max_gain_pct FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL",
).all() as Row[];
const N = traded.length, W = traded.filter(isWin).length;
p(`traded=${N} winners=${W} base=${(100 * W / N).toFixed(1)}%\n`);

function permTest(name: string, mask: (r: Row) => boolean, iters = 20000) {
  const keptIdx = traded.map((r, i) => (mask(r) ? i : -1)).filter((i) => i >= 0);
  const k = keptIdx.length;
  const obsWin = keptIdx.filter((i) => isWin(traded[i]!)).length;
  // permutation: randomly choose k of N rows, count winners among them
  const winFlags = traded.map(isWin);
  let geObs = 0;
  for (let it = 0; it < iters; it++) {
    // Fisher-Yates partial shuffle to pick k indices
    const idx = winFlags.map((_, i) => i);
    let cnt = 0;
    for (let j = 0; j < k; j++) {
      const r = j + Math.floor(Math.random() * (N - j));
      const tmp = idx[j]!; idx[j] = idx[r]!; idx[r] = tmp;
      if (winFlags[idx[j]!]) cnt++;
    }
    if (cnt >= obsWin) geObs++;
  }
  const pVal = geObs / iters;
  p(`# ${name}: kept=${k} winners=${obsWin} win%=${(100 * obsWin / k).toFixed(1)} (base ${(100 * W / N).toFixed(1)}%)`);
  p(`  permutation one-sided p(>= ${obsWin} winners by chance) = ${pVal.toFixed(4)}  ${pVal < 0.05 ? "SIGNIFICANT" : "not significant"}`);
  p("");
}

permTest("momentum >= 85", (r) => num(J(r.scores).momentum) >= 85);
permTest("momentum >= 80", (r) => num(J(r.scores).momentum) >= 80);
permTest("txns5m >= 150", (r) => dexTxns(r) >= 150);
permTest("momentum>=83 AND txns5m>=150", (r) => num(J(r.scores).momentum) >= 83 && dexTxns(r) >= 150);

// eslint-disable-next-line no-console
console.log(out.join("\n"));
db.close();
