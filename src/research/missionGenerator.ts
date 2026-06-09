import type { Decision, SafetyResult, GraphIntel } from "../types.js";
import type { AttentionRecord } from "../attention/attentionService.js";
import type { Mission, MissionBucket, MissionBucketKey } from "./mission.types.js";

// Pure: turn everything the engine already knows about a candidate into a
// structured Mission. Deterministic — takes `now`, never reads the clock — so it
// is unit-testable and reproducible. The whole point is to PRE-FILL the evidence
// the engine collected (so a provider/operator doesn't redo free work) and to
// surface the THIN buckets a deeper attention pass should actually target.

export interface MissionInput {
  decision: Decision;
  safety: SafetyResult;
  /** Attention research result, if a pass has already run. */
  attention?: AttentionRecord;
  /** Graph intelligence (bull/bear evidence), if computed. */
  intel?: GraphIntel;
  /** Known liquidity in USD, if available (RugCheck / DexScreener). */
  liquidityUsd?: number;
  now: number;
}

/** Coverage below this ⇒ the bucket is thin and worth a deeper look. */
const THIN = 0.5;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}

const OUTPUT_CONTRACT =
  'Return STRICT JSON: {"recommendation":"confirm"|"caution"|"unsure"|"avoid",' +
  '"confidence":0-100,"scores":{"humanity":0-100,"virality":0-100,"outsideCrypto":0-100,' +
  '"culturalStrength":0-100,"attention":0-100},"narrative":"<one line>","reasons":["..."]}. ' +
  "Your output is ADVISORY: the engine maps it onto the attention facet and re-scores through " +
  "its hard safety gate — it cannot force a buy or bypass safety. Do NOT defend a weak candidate; " +
  "if the thin buckets resolve negative, return avoid.";

export function generateMission(input: MissionInput): Mission {
  const { decision: d, safety, attention, intel } = input;
  const s = d.scores;
  const checks = safety.checks ?? [];
  const buckets: MissionBucket[] = [];
  const add = (key: MissionBucketKey, known: string[], coverage: number): void => {
    const cov = clamp01(coverage);
    buckets.push({ key, known, coverage: cov, thin: cov < THIN });
  };

  // ── rugcheck: safety checks (mint/freeze authority, honeypot, risk level). ──
  const knownChecks = checks.filter((c) => c.status !== "UNKNOWN").length;
  add(
    "rugcheck",
    [
      `safety gate ${safety.pass ? "PASS" : "FAIL"}`,
      ...checks.map((c) => `${c.label}: ${c.status}${c.detail ? ` (${c.detail})` : ""}`),
    ],
    checks.length ? knownChecks / checks.length : 0,
  );

  // ── holders: concentration check, if present. ──
  const holder = checks.find((c) => /holder/i.test(c.id) || /holder/i.test(c.label));
  add(
    "holders",
    holder ? [`${holder.label}: ${holder.status}${holder.detail ? ` (${holder.detail})` : ""}`] : ["holder concentration unknown (free feed)"],
    holder && holder.status !== "UNKNOWN" ? 1 : 0,
  );

  // ── liquidity: known USD depth. ──
  const liq = input.liquidityUsd;
  add(
    "liquidity",
    liq && liq > 0 ? [`liquidity $${Math.round(liq).toLocaleString("en-US")}`] : ["liquidity unknown (bonding-curve / no DEX pair yet)"],
    liq && liq > 0 ? 1 : 0,
  );

  // ── chart: DexScreener run-up + momentum + late-entry risk. ──
  const haveDexChart = s.recentM5Pct != null || s.recentH1Pct != null;
  add(
    "chart",
    [
      `momentum ${Math.round(s.momentum)}`,
      `run-up m5 ${fmtPct(s.recentM5Pct)} · h1 ${fmtPct(s.recentH1Pct)}`,
      `late-entry risk ${Math.round(s.lateEntryRisk)}`,
    ],
    haveDexChart ? 1 : 0.4,
  );

  // ── social: heuristic-only on the free feed — deliberately treated as thin. ──
  add("social", [`social score ${Math.round(s.social)} (heuristic — weak on free feed)`], 0.4);

  // ── narrative: AI hype + attention narrative/tags. ──
  const narrKnown = [`hype ${Math.round(s.hype)}`];
  if (attention) {
    narrKnown.push(attention.scores.narrative);
    if (attention.scores.tags.length) narrKnown.push(`tags: ${attention.scores.tags.join(", ")}`);
  }
  add("narrative", narrKnown, attention ? 0.7 : s.hype > 0 ? 0.4 : 0.2);

  // ── attention: the composite read; coverage IS the research confidence. ──
  if (attention) {
    const a = attention.scores;
    add(
      "attention",
      [
        `attention ${Math.round(a.attention)} (H${Math.round(a.humanity)} V${Math.round(a.virality)} OC${Math.round(a.outsideCrypto)} C${Math.round(a.culturalStrength)})`,
        `confidence ${Math.round(a.confidence * 100)}% · ${attention.source}`,
      ],
      a.confidence,
    );
  } else {
    add("attention", ["not researched yet"], 0);
  }

  // ── influencer: who is talking — unique authors + platforms from evidence. ──
  if (attention) {
    const ev = attention.evidence;
    const authors = new Set(ev.posts.map((p) => p.author).filter(Boolean)).size;
    add(
      "influencer",
      [`${authors} unique authors across ${ev.platforms.length} platform(s): ${ev.platforms.join(", ") || "none"}`],
      Math.min(authors, 5) / 5,
    );
  } else {
    add("influencer", ["no chatter collected yet"], 0);
  }

  // ── bearCase: what could go wrong — red flags + graph bear evidence. ──
  const bearKnown = [
    ...(d.redFlags ?? []),
    ...((intel?.bear ?? []).map((b) => b.label)),
  ];
  add(
    "bearCase",
    bearKnown.length ? bearKnown : ["no bear evidence surfaced — construct the failure modes"],
    bearKnown.length ? 0.6 : 0.3,
  );

  const gaps = buckets.filter((b) => b.thin).map((b) => b.key);
  const objective =
    `Verdict ${d.verdict} at conviction ${d.conviction}. Decide whether ATTENTION will GROW in the next ` +
    `2-12h before it collapses — attention is the asset, the coin is only the vehicle. Confirm or refute the ` +
    `thin evidence buckets${gaps.length ? ` (${gaps.join(", ")})` : ""}, then return a recommendation.`;

  return {
    mint: d.mint,
    symbol: d.symbol,
    name: d.name,
    objective,
    verdict: d.verdict,
    conviction: d.conviction,
    buckets,
    gaps,
    outputContract: OUTPUT_CONTRACT,
    createdAt: input.now,
  };
}

function fmtPct(x: number | undefined): string {
  return x == null ? "n/a" : `${x >= 0 ? "+" : ""}${Math.round(x)}%`;
}
