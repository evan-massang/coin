import type { Services } from "../services.js";

// Builds the dashboard "Reasoning Feed" + the downloadable report: a single,
// time-ordered view of WHY the engine + AI council bought / sold / avoided each
// coin. Read-only over the journals (signals, council_opinions, paper_trades).

export interface ReasoningItem {
  kind: "council" | "buy" | "sell" | "avoid" | "attention";
  at: number;
  symbol: string;
  mint: string;
  headline: string;
  tone: "bull" | "bear" | "neutral";
  lines: string[];
  pnlSol?: number;
}

interface Gathered {
  council: ReasoningItem[];
  buys: ReasoningItem[];
  sells: ReasoningItem[];
  avoids: ReasoningItem[];
  attention: ReasoningItem[];
  symOf: (mint: string) => string;
}

function gather(svc: Services, limit: number): Gathered {
  const signals = svc.signals.recent(Math.max(300, limit * 6));
  const symMap = new Map<string, string>();
  for (const s of signals) if (s.symbol) symMap.set(s.mint, s.symbol);
  const symOf = (mint: string) => symMap.get(mint) || mint.slice(0, 6);

  // ── Council: group flat opinions into debate sessions (all seats share `at`). ──
  const opinions = svc.council.recent(Math.max(limit * 6, 120));
  const sessions = new Map<string, typeof opinions>();
  for (const o of opinions) {
    const key = `${o.mint}|${o.at}`;
    if (!sessions.has(key)) sessions.set(key, []);
    sessions.get(key)!.push(o);
  }
  const council: ReasoningItem[] = [];
  for (const seats of sessions.values()) {
    const at = seats[0]!.at;
    const mint = seats[0]!.mint;
    const confirms = seats.filter((s) => s.recommendation === "confirm").length;
    const avg = Math.round(seats.reduce((a, s) => a + s.score, 0) / seats.length);
    const outcome = seats.find((s) => s.outcome)?.outcome;
    council.push({
      kind: "council",
      at,
      mint,
      symbol: seats[0]!.symbol || symOf(mint),
      headline: `${confirms}/${seats.length} bullish · avg ${avg}${outcome ? ` · outcome ${outcome}` : ""}`,
      tone: confirms > seats.length / 2 ? "bull" : confirms === 0 ? "bear" : "neutral",
      lines: seats.map((s) => `${s.label} [${s.role}] ${s.recommendation.toUpperCase()} ${s.score} — ${oneLine(s.rationale)}`),
    });
  }

  // ── Buys / Avoids from the signal journal. ──
  const buys: ReasoningItem[] = [];
  const avoids: ReasoningItem[] = [];
  for (const s of signals) {
    if (s.verdict === "BUY_SMALL" || s.verdict === "BUY_STRONG") {
      const resolved = s.maxGainPct != null ? ` · peak ${s.maxGainPct >= 0 ? "+" : ""}${Math.round(s.maxGainPct)}%` : "";
      // Entry-timing context: the run-up the coin had AT entry (DexScreener m5/h1)
      // + the late-entry risk. Makes "did we chase / buy the top?" visible per trade.
      const m5 = s.scores.recentM5Pct;
      const h1 = s.scores.recentH1Pct;
      const entryCtx =
        m5 != null || h1 != null
          ? [
              `entry run-up: m5 ${fmtPct(m5)} · h1 ${fmtPct(h1)} · late-entry risk ${Math.round(s.scores.lateEntryRisk ?? 0)}` +
                (s.flags.includes("late-entry-shadow") ? "  ⚠ would block (shadow)" : ""),
            ]
          : [];
      buys.push({
        kind: "buy",
        at: s.at,
        mint: s.mint,
        symbol: s.symbol || symOf(s.mint),
        headline: `${s.verdict} · conviction ${s.conviction} · ${s.riskTier ?? "?"}${resolved}`,
        tone: "bull",
        lines: [...entryCtx, ...s.reasons, ...(s.caps.length ? [`caps: ${s.caps.join(", ")}`] : []), ...(s.regime ? [`regime ${s.regime} · weather ${s.marketWeather ?? "?"}`] : [])],
      });
    } else if (s.verdict === "AVOID" && avoids.length < limit) {
      avoids.push({
        kind: "avoid",
        at: s.at,
        mint: s.mint,
        symbol: s.symbol || symOf(s.mint),
        headline: `AVOID · conviction ${s.conviction}`,
        tone: "bear",
        lines: [...(s.reasons.length ? s.reasons.slice(0, 3) : s.caps.slice(0, 2))],
      });
    }
  }

  // ── Sells / exits from the paper fills. ──
  const sells: ReasoningItem[] = [];
  for (const f of svc.paper.fills(Math.max(limit * 3, 120))) {
    if (f.side !== "sell") continue;
    const pnl = f.realizedPnlSol;
    sells.push({
      kind: "sell",
      at: f.at,
      mint: f.mint,
      symbol: symOf(f.mint),
      headline: f.reason || "sell",
      tone: pnl != null && pnl >= 0 ? "bull" : "bear",
      lines: [],
      pnlSol: pnl,
    });
  }

  // ── Attention Intelligence research (Project Athena) — why humans care. ──
  const attention: ReasoningItem[] = [];
  for (const r of svc.attention?.recent(30) ?? []) {
    const s = r.scores;
    attention.push({
      kind: "attention",
      at: r.at,
      mint: r.mint,
      symbol: r.evidence.symbol || symOf(r.mint),
      headline: `attention ${Math.round(s.attention)} · H${Math.round(s.humanity)} V${Math.round(s.virality)} OC${Math.round(s.outsideCrypto)} C${Math.round(s.culturalStrength)} (${r.source})`,
      tone: s.attention >= 60 ? "bull" : s.attention <= 35 ? "bear" : "neutral",
      lines: [s.narrative, ...s.reasons.slice(0, 3), `evidence: ${r.evidence.posts.length} posts · ${r.evidence.platforms.join(", ") || "none"}`],
    });
  }

  return { council, buys, sells, avoids, attention, symOf };
}

/** Merged, newest-first reasoning stream for the live dashboard panel. */
export function buildReasoningFeed(svc: Services, limit = 60): ReasoningItem[] {
  const g = gather(svc, limit);
  return [...g.council, ...g.attention, ...g.buys, ...g.sells]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

/** Full, downloadable plain-text report (same content as `npm run transcript`). */
export function buildReasoningReport(svc: Services, limit = 60): string {
  const g = gather(svc, limit);
  const out: string[] = [];
  const p = (s = "") => out.push(s);
  const ts = (ms: number) => new Date(ms || 0).toISOString().replace("T", " ").slice(0, 19);

  p("=".repeat(80));
  p(`  COIN AI -- REASONING REPORT        generated ${ts(Date.now())}`);
  p(`  read-only paper engine | advisory AI | never holds a key, never signs`);
  p("=".repeat(80));

  p(`\n\n${"#".repeat(80)}\n## 1. AI COUNCIL -- what each analyst argued (newest first)\n${"#".repeat(80)}`);
  for (const c of g.council.sort((a, b) => b.at - a.at).slice(0, limit)) {
    p(`\n--- $${c.symbol}  (${c.mint.slice(0, 10)}...)  ${ts(c.at)}  | ${c.headline} ---`);
    for (const l of c.lines) p(`  * ${l}`);
  }

  p(`\n\n${"#".repeat(80)}\n## 2. BUY DECISIONS -- why the engine bought (newest first)\n${"#".repeat(80)}`);
  for (const b of g.buys.slice(0, limit)) {
    p(`\n--- $${b.symbol}  ${b.headline}  ${ts(b.at)} ---`);
    for (const l of b.lines) p(`      * ${l}`);
  }

  p(`\n\n${"#".repeat(80)}\n## 3. SELLS / EXITS -- why positions were closed (newest first)\n${"#".repeat(80)}`);
  for (const s of g.sells.slice(0, limit * 3)) {
    const pnl = s.pnlSol != null ? ` ${s.pnlSol >= 0 ? "+" : ""}${s.pnlSol.toFixed(3)} SOL` : "";
    p(`  ${ts(s.at)}  $${s.symbol}  --  ${s.headline}${pnl}`);
  }

  p(`\n\n${"#".repeat(80)}\n## 4. RECENT AVOIDS -- a sample of what it rejected and why\n${"#".repeat(80)}`);
  for (const a of g.avoids.slice(0, Math.min(limit, 25))) {
    p(`  ${ts(a.at)}  $${a.symbol}  conv -- ${a.lines.join(" · ") || a.headline}`);
  }

  return out.join("\n");
}

function oneLine(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

/** Format a signed percentage for the reasoning feed; "n/a" when absent. */
function fmtPct(x: number | undefined): string {
  return x == null ? "n/a" : `${x >= 0 ? "+" : ""}${Math.round(x)}%`;
}
