/**
 * FULL REASONING TRANSCRIPT (READ-ONLY). Dumps WHY the engine + AI council
 * bought / sold / avoided each coin, for the operator to read. Sections:
 *   1. AI COUNCIL — every seat's argument per coin (confirm/caution + rationale)
 *   2. BUY DECISIONS — the engine's own reasons + the resolved outcome
 *   3. SELLS / EXITS — paper fills with the exit reason + realized PnL
 *   4. RECENT AVOIDS — a sample of what it rejected and why
 * Writes transcript.txt (full) and prints the head to the console.
 *   npm run transcript            (last 40 of each)
 *   npx tsx scripts/transcript.ts 100
 */
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });
const LIMIT = Math.max(1, Number(process.argv[2] ?? 40));
const Q = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as Array<Record<string, unknown>>;
const ts = (ms: unknown) => new Date(Number(ms) || 0).toISOString().replace("T", " ").slice(0, 19);
const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
const arr = (v: unknown): string[] => { try { const x = JSON.parse(String(v)); return Array.isArray(x) ? x : []; } catch { return []; } };
const oneLine = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

const out: string[] = []; const p = (s = "") => out.push(s);

const symOf = new Map<string, string>();
for (const r of Q("SELECT mint, symbol FROM signals WHERE symbol IS NOT NULL GROUP BY mint")) symOf.set(String(r.mint), String(r.symbol));
const sym = (mint: unknown) => symOf.get(String(mint)) || String(mint ?? "").slice(0, 6);

p("=".repeat(80));
p(`  COIN AI -- REASONING TRANSCRIPT        generated ${ts(Date.now())}`);
p(`  read-only paper engine | advisory AI | never holds a key, never signs`);
p("=".repeat(80));

// ── 1. AI COUNCIL ────────────────────────────────────────────────────────────
p(`\n\n${"#".repeat(80)}\n## 1. AI COUNCIL -- what each analyst argued (newest coins first)\n${"#".repeat(80)}`);
const opinions = Q("SELECT * FROM council_opinions ORDER BY at DESC");
const byMint = new Map<string, Array<Record<string, unknown>>>();
for (const o of opinions) {
  const m = String(o.mint);
  if (!byMint.has(m)) byMint.set(m, []);
  byMint.get(m)!.push(o);
}
let nC = 0;
for (const [mint, seats] of byMint) {
  if (nC++ >= LIMIT) break;
  const at = Math.max(...seats.map((s) => num(s.at)));
  const outcome = seats.find((s) => s.outcome)?.outcome;
  const confirms = seats.filter((s) => s.recommendation === "confirm").length;
  p(`\n--- $${sym(mint)}  (${mint.slice(0, 10)}...)  ${ts(at)}  | ${confirms}/${seats.length} bullish${outcome ? `  => OUTCOME: ${String(outcome).toUpperCase()}` : ""} ---`);
  for (const s of seats) {
    p(`  * ${s.label} [${s.role}] -- ${String(s.recommendation).toUpperCase()} ${num(s.score)}${s.model ? `  (${s.model})` : ""}`);
    p(`      ${oneLine(s.rationale) || "(no rationale)"}`);
  }
}
p(`\n(${byMint.size} coins debated · ${opinions.length} total seat opinions on record)`);

// ── 2. BUYS ──────────────────────────────────────────────────────────────────
p(`\n\n${"#".repeat(80)}\n## 2. BUY DECISIONS -- why the engine bought (newest first)\n${"#".repeat(80)}`);
for (const b of Q("SELECT * FROM signals WHERE verdict IN ('BUY_SMALL','BUY_STRONG') ORDER BY at DESC LIMIT ?", LIMIT)) {
  const gain = b.max_gain_pct;
  const dd = b.max_drawdown_pct;
  const resolved = gain != null ? `peak ${num(gain) >= 0 ? "+" : ""}${Math.round(num(gain))}% / drawdown -${Math.round(num(dd) || 0)}%` : "open / unresolved";
  p(`\n--- $${b.symbol || sym(b.mint)}  ${b.verdict}  conviction ${num(b.conviction)}  risk ${b.risk_tier ?? "?"}  ${ts(b.at)}  => ${resolved} ---`);
  for (const r of arr(b.reasons)) p(`      * ${r}`);
  const flags = arr(b.flags), caps = arr(b.caps);
  if (flags.length) p(`      flags: ${flags.join(", ")}`);
  if (caps.length) p(`      caps:  ${caps.join(", ")}`);
  if (b.regime) p(`      regime: ${b.regime}   weather: ${b.market_weather ?? "?"}`);
}

// ── 3. SELLS / EXITS ─────────────────────────────────────────────────────────
p(`\n\n${"#".repeat(80)}\n## 3. SELLS / EXITS -- why positions were closed (newest first)\n${"#".repeat(80)}`);
for (const s of Q("SELECT * FROM paper_trades WHERE side='sell' ORDER BY at DESC LIMIT ?", LIMIT * 3)) {
  const pnl = s.realized_pnl_sol;
  const pnlStr = pnl != null ? ` ${num(pnl) >= 0 ? "+" : ""}${num(pnl).toFixed(3)} SOL` : "";
  p(`  ${ts(s.at)}  $${sym(s.mint)}  --  ${s.reason || "(sell)"}${pnlStr}`);
}

// ── 4. RECENT AVOIDS (a sample of what it rejected and why) ───────────────────
p(`\n\n${"#".repeat(80)}\n## 4. RECENT AVOIDS -- a sample of what it rejected and why\n${"#".repeat(80)}`);
for (const a of Q("SELECT * FROM signals WHERE verdict='AVOID' ORDER BY at DESC LIMIT ?", Math.min(LIMIT, 25))) {
  const reasons = arr(a.reasons).slice(0, 3).join(" · ");
  const caps = arr(a.caps).slice(0, 2).join(" · ");
  p(`  ${ts(a.at)}  $${a.symbol || sym(a.mint)}  conv ${num(a.conviction)}  — ${reasons || caps || "gate/safety reject"}`);
}

const text = out.join("\n");
fs.writeFileSync(path.resolve("transcript.txt"), text, "utf8");
// eslint-disable-next-line no-console
console.log(text);
// eslint-disable-next-line no-console
console.log(`\n\n>>> full transcript saved to transcript.txt (${text.length} chars). Re-run anytime: npm run transcript`);
db.close();
