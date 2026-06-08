/**
 * AUDIT 7 — out-of-sample / data-snooping guard (READ-ONLY). The momentum>=85 gate
 * was chosen AFTER seeing the full-sample table, so it may be overfit. Split the
 * traded rows chronologically by `at` (first 50% = train, last 50% = test). The gate
 * must beat base rate on the HELD-OUT test half to be credible.
 *   npx tsx scripts/research/_audit_prepump4.ts
 */
import Database from "better-sqlite3";
import path from "node:path";
const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const J = (v: unknown): Record<string, number> => { try { return JSON.parse(String(v)); } catch { return {}; } };
type Row = Record<string, unknown>;
const isWin = (r: Row) => num(r.max_gain_pct) >= 100;
const out: string[] = []; const p = (s = "") => out.push(s);

const traded = (db.prepare(
  "SELECT at, scores, max_gain_pct FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') AND max_gain_pct IS NOT NULL ORDER BY at ASC",
).all() as Row[]);
const mid = Math.floor(traded.length / 2);
const train = traded.slice(0, mid), test = traded.slice(mid);
const wr = (set: Row[]) => set.length ? 100 * set.filter(isWin).length / set.length : NaN;
const mom = (r: Row) => num(J(r.scores).momentum);

p(`traded=${traded.length}  train(early)=${train.length}  test(late)=${test.length}`);
p(`base win%: train=${wr(train).toFixed(1)}  test=${wr(test).toFixed(1)}\n`);

for (const T of [80, 83, 85]) {
  const trK = train.filter((r) => mom(r) >= T), teK = test.filter((r) => mom(r) >= T);
  p(`momentum>=${T}:  train n=${trK.length} win%=${wr(trK).toFixed(1)} (lift ${(wr(trK) / wr(train)).toFixed(2)}x)   |   TEST n=${teK.length} win%=${wr(teK).toFixed(1)} (lift ${(wr(teK) / wr(test)).toFixed(2)}x)`);
}

// also show date range so we know the window
const ts = traded.map((r) => num(r.at)).filter(Number.isFinite);
p(`\nwindow: ${new Date(Math.min(...ts)).toISOString()} .. ${new Date(Math.max(...ts)).toISOString()}`);

// eslint-disable-next-line no-console
console.log(out.join("\n"));
db.close();
