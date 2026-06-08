/**
 * READ-ONLY: are FRESH signals (post-restart) recording the new entry-timing
 * instrumentation (recentM5Pct/recentH1Pct) and is the shadow guard firing?
 *   npx tsx scripts/research/_audit_freshsignals.ts
 */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

type Row = { id: number; at: number; verdict: string; symbol: string | null; conviction: number; scores: string | null; flags: string | null };

// Look only at the most recent 400 signals (the fresh, post-restart ones).
const rows = db.prepare(`SELECT id, at, verdict, symbol, conviction, scores, flags FROM signals ORDER BY at DESC LIMIT 400`).all() as Row[];

let withM5 = 0, withH1 = 0, shadowFlag = 0;
let lateNonzeroNew = 0;
const samples: string[] = [];
const newest = rows[0]?.at ?? 0;

for (const r of rows) {
  let s: any = {};
  try { s = JSON.parse(r.scores ?? "{}"); } catch { /* */ }
  let f: string[] = [];
  try { f = JSON.parse(r.flags ?? "[]"); } catch { /* */ }
  const hasM5 = typeof s.recentM5Pct === "number";
  const hasH1 = typeof s.recentH1Pct === "number";
  if (hasM5) withM5++;
  if (hasH1) withH1++;
  if (f.includes("late-entry-shadow")) shadowFlag++;
  if (hasM5 && samples.length < 12) {
    samples.push(
      `  ${r.verdict.padEnd(11)} $${(r.symbol ?? "?").slice(0, 8).padEnd(8)} conv=${String(r.conviction).padStart(3)} m5=${fmt(s.recentM5Pct)} h1=${fmt(s.recentH1Pct)} lateRisk=${String(Math.round(s.lateEntryRisk ?? 0)).padStart(3)}${f.includes("late-entry-shadow") ? "  <= SHADOW would-block" : ""}`,
    );
  }
}

function fmt(x: number | undefined): string {
  return x == null ? " n/a" : `${x >= 0 ? "+" : ""}${Math.round(x)}%`.padStart(6);
}

console.log(`scanned ${rows.length} most-recent signals (newest at ${new Date(newest).toISOString().slice(11, 19)} UTC)`);
console.log(`recording recentM5Pct: ${withM5}   recentH1Pct: ${withH1}`);
console.log(`late-entry-shadow flag fired (would-block in shadow): ${shadowFlag}`);
console.log(`\nsample (signals with a recorded m5 run-up):`);
for (const l of samples) console.log(l);

// Distribution of recorded lateEntryRisk on the fresh window (did wiring change it?)
const risks: number[] = [];
for (const r of rows) { try { const s = JSON.parse(r.scores ?? "{}"); if (typeof s.lateEntryRisk === "number") risks.push(s.lateEntryRisk); } catch { /* */ } }
if (risks.length) {
  const sorted = [...risks].sort((a, b) => a - b);
  console.log(`\nfresh lateEntryRisk: n=${risks.length} max=${Math.max(...risks)} p90=${sorted[Math.floor(0.9 * sorted.length)]} >70=${risks.filter((x) => x > 70).length}`);
}
db.close();
