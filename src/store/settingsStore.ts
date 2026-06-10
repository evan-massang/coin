import { z } from "zod";
import type { DB } from "./db.js";
import type { SettingChange } from "../types.js";
import { CouncilMemberConfigSchema, DEFAULT_COUNCIL } from "../council/roles.js";

// ─────────────────────────────────────────────────────────────────────────────
// Typed settings, persisted as JSON key/value rows in the `settings` table and
// edited from the dashboard Settings tab. Every numeric/string/bool round-trips
// through JSON so types are preserved. Changes are logged to setting_change_log.
//
// NOTE: there is no private key here, by design. The closest things to secrets
// are optional third-party API keys, which the user pastes in the UI.
// ─────────────────────────────────────────────────────────────────────────────

export const SettingsSchema = z.object({
  // ── Wallet (read-only observer) ──
  walletAddress: z.string().default(""),
  walletObserverEnabled: z.boolean().default(false),

  // ── Alerts ──
  desktopNotifications: z.boolean().default(true),
  sound: z.boolean().default(true),
  /** Minimum conviction for a BUY_* alert to fire a loud notification. */
  minConviction: z.number().min(0).max(100).default(60),

  // ── Risk gates ──
  maxTopHolderPct: z.number().min(0).max(100).default(25),
  minOrganicScore: z.number().min(0).max(100).default(55),
  maxLateEntryRisk: z.number().min(0).max(100).default(70),
  /** Enforce the late-entry guard (block as TOO_LATE) vs SHADOW (record + flag only).
   *  Default SHADOW: the guard is now fed real DexScreener run-up (m5/h1), but we
   *  measure run-up→outcome before blocking trades — winners dip before they rip,
   *  so blocking blind would repeat the refuted "exit-if-red-at-15m" mistake. */
  lateEntryEnforce: z.boolean().default(false),
  maxHoldMinutes: z.number().min(1).default(240),
  /** Cut a position this far below entry (meme coins die fast). 0 disables.
   *  Cycle 8: 0.45→0.40. Backtest (1,229 BUYs): a slightly tighter stop paired with
   *  the early-harvest ladder reduces the loser bleed on both ordering bounds without
   *  losing winners (100% of 2x-winners breach −45% anyway). Reversible setting. */
  stopLossPct: z.number().min(0).max(0.9).default(0.4),
  minLiquidityUsd: z.number().min(0).default(3000),

  // ── Paper trading (Mode 3 — simulation only) ──
  paperEnabled: z.boolean().default(false),
  paperStartingBalanceSol: z.number().min(0).default(10),
  paperMaxPositionSol: z.number().min(0).default(1),
  paperRiskPerTradePct: z.number().min(0).max(100).default(3),
  /** Assumed slippage + fee on paper fills, for realism. */
  paperSlippagePct: z.number().min(0).max(100).default(2),

  // ── MiroFish dynamic risk sizing (advisory / paper-only) ──
  riskMode: z.enum(["microfish", "fixed"]).default("microfish"),
  baseRiskPct: z.number().min(0).max(100).default(1),
  maxRiskPct: z.number().min(0).max(100).default(2),
  minRiskPct: z.number().min(0).max(100).default(0.1),
  riskOffMultiplier: z.number().min(0).max(1).default(0.35),
  sourceConflictMultiplier: z.number().min(0).max(1).default(0.5),

  // ── Learning ──
  learningMode: z.enum(["manual", "auto"]).default("manual"),
  /** Auto-tune rail: max % change to any threshold per day. */
  autoTuneMaxDailyPct: z.number().min(0).max(100).default(5),
  /** Auto-tune rail: minOrganicScore can never drop below this floor. */
  organicFloor: z.number().min(0).max(100).default(40),

  // ── Verdict thresholds (tunable by learning, within rails) ──
  // HARD FLOOR (V5.1 red-team fix): the conviction gate can be RAISED but never
  // lowered below its calibrated values — replay proved gate 40 ⇒ −136 SOL. This
  // is now enforced server-side by the schema (PUT /settings 400s below floor),
  // not just by convention.
  minConvictionBuySmall: z.number().min(55).max(100).default(55),
  minConvictionBuyStrong: z.number().min(72).max(100).default(72),

  // ── Observation coverage (Cycle 3 — recycle watch slots toward active tokens) ──
  /** Demand-driven watch-slot recycling: evict dead slots to watch fresh survivors. */
  adaptiveWatchEnabled: z.boolean().default(true),
  /** Cycle 4: derive organic/momentum from DexScreener aggregates (FREE) since the
   *  PumpPortal per-trade stream is a paid feature. The real trade-flow source. */
  dexFallbackEnabled: z.boolean().default(true),

  // ── Maturing-survivor scanner (Cycle 8 — the operator's "Golden Filter") ──
  /** Scan DexScreener boosts/profiles for GRADUATED coins (real Raydium pool ⇒
   *  reliable price/liquidity + RugCheck/authorities resolve ⇒ safety+sizing work)
   *  instead of only blind seconds-old newborns. Off by default. */
  scanEnabled: z.boolean().default(true),
  /** Journal scanner candidates but do NOT paper-buy them — A/B their forward
   *  outcomes vs the newborn feed before trading them. Default true (shadow). */
  scanShadowOnly: z.boolean().default(true),
  scanMinMcapUsd: z.number().min(0).default(50_000),
  scanMaxMcapUsd: z.number().min(0).default(200_000),
  /** Min pool liquidity. Operator's spec was $30k, but live data showed pump.fun
   *  graduates with only ~$12–17k LP so $30k matched nothing — set to $15k to match
   *  graduation reality; the shadow journal will inform final tuning. */
  scanMinLiqUsd: z.number().min(0).default(15_000),
  scanMinVolMcRatio: z.number().min(0).default(2),
  scanMaxAgeHours: z.number().min(0).default(6),
  scanIntervalSec: z.number().int().min(30).max(1800).default(120),

  // ── Attention Intelligence / autonomous research (Project Athena) ──
  /** Auto-research shortlisted (WATCH/BUY) coins for attention signals. */
  attentionEnabled: z.boolean().default(true),
  /** Local Ollama model for the attention judge (e.g. "qwen2.5:14b" / "gemma2:9b").
   *  "" = deterministic heuristic agents only (free, no model needed). */
  attentionLlmModel: z.string().default(""),
  /** Also try Reddit/DDG via a real browser during research (slow + flaky here due
   *  to an HTTPS-inspection layer). Default off → fast, reliable News+Wikipedia. */
  attentionUseBrowser: z.boolean().default(false),
  /** Re-research a coin only if its cached attention is older than this (minutes). */
  attentionTtlMin: z.number().int().min(1).max(360).default(30),
  /** Athena Readiness Gate (Phase 21): hold a would-be BUY at WATCH until attention
   *  research has actually RUN for the coin, then let the re-score make the real,
   *  attention-informed buy. This is what makes attention GATE executed trades
   *  instead of just watching. Only active when attention is enabled + weighted. */
  attentionReadinessGate: z.boolean().default(true),

  // ── Evidence sufficiency (Cycle 1 fix — NOT auto-tunable; structural safety) ──
  /** Min observed trades before organic/momentum carry confidence. Floored at 8. */
  minBuysToDecide: z.number().int().min(8).max(50).default(8),
  // ── Observation timing (tunable; defaults = current behavior). Longer windows
  //    are a candidate for later — NOT shipped as a default change because the
  //    audit showed coin "age" is unverifiable today (tokens.created_at is faked). ──
  observeWindowSec: z.number().int().min(60).max(1800).default(90),
  minObserveSec: z.number().int().min(15).max(900).default(25),
  /** Min momentum facet to allow a BUY (0 = off). Cycle-7 audit found momentum≥85
   *  ~doubles the 2x hit-rate (15% vs 6.5%, significant, out-of-sample). Default OFF
   *  pending ≥1 week of multi-regime data (the audit's sample was one 3.7h window);
   *  set to 85 in CONFIG to enable the selection edge. */
  minMomentumForBuy: z.number().min(0).max(100).default(0),
  /** Momentum CEILING for a BUY (0 = off). Cycle-8 backtest on 1,239 resolved BUYs:
   *  momentum is the dominant ANTI-predictive driver of REALIZED PnL — filtering to
   *  momentum<70 halves the per-trade loss (realized mid −17%→−8%, pess −25.7%→−12.5%).
   *  A hot momentum facet means we're chasing a spike that mean-reverts. Default 70
   *  (ON) — reversible; measured forward against the −5.66 SOL baseline. */
  /** Superseded by the Cycle-8 momentum RESHAPE (dexMomentum now scores the early/dip
   *  sweet-spot high and chases low), which made a "high momentum = chase" ceiling
   *  contradictory. Default 0 (off); the run-up gate below is the chase backstop. */
  maxMomentumForBuy: z.number().min(0).max(100).default(0),
  /** Max recent 5-minute run-up (DexScreener priceChange.m5 %) to allow a BUY; above
   *  it we're chasing a coin that already popped. 0 = off. Cycle-8 calibration on
   *  2,760 resolved signals with recorded run-up: realized PnL is −7% for m5 0–25%
   *  but −16% for m5 25–75%. Default 30 (block the clear chase zone). Reversible. */
  maxEntryRunupM5Pct: z.number().min(0).max(2000).default(30),
  /** Facets below this confidence are dropped from the conviction blend. Floored at 0.5. */
  convictionConfidenceFloor: z.number().min(0.5).max(0.95).default(0.5),
  /** If real-evidence coverage (excl. social/hype) is below this, conviction is capped to WATCH. */
  minRealCoverage: z.number().min(0).max(1).default(0.5),
  /** Min resolved REAL trades (BUYs) before the engine's own win-rate may flip
   *  market weather to RISK_OFF. Below this, weather is macro-only — a cold-start
   *  guard so a tiny traded sample can't false-trigger RISK_OFF and floor every
   *  BUY to TINY (Cycle 5). Structural safety; NOT auto-tunable. */
  minWeatherSamples: z.number().int().min(10).max(200).default(20),

  // ── Conviction weights (tunable by learning, within rails) ──
  // CEILINGS (V5.1 red-team fix): no single facet may be weighted to dominate the
  // blend, and the advisory anchors (social/hype) keep structurally small caps so
  // "AI narrative can never force a BUY" stays true under any settings input.
  weightOrganic: z.number().min(0).max(60).default(15),
  weightMomentum: z.number().min(0).max(60).default(30),
  weightGraduation: z.number().min(0).max(60).default(12),
  weightDevReputation: z.number().min(0).max(60).default(12),
  weightSmartMoney: z.number().min(0).max(60).default(18),
  weightSocial: z.number().min(0).max(20).default(8),
  /** AI narrative weight — kept small; confirmation only. */
  weightHype: z.number().min(0).max(15).default(5),
  /** Attention Intelligence (Project Athena) weight. Confidence-gated in the blend,
   *  so it only moves conviction for coins that were actually researched (newborns
   *  with no web footprint are unaffected). Tunable up toward a first-class signal. */
  weightAttention: z.number().min(0).max(45).default(18),

  // ── Optional API keys (free tiers; all optional) ──
  heliusApiKey: z.string().default(""),
  birdeyeApiKey: z.string().default(""),
  anthropicApiKey: z.string().default(""),
  rugcheckApiKey: z.string().default(""),
  lunarcrushApiKey: z.string().default(""),

  // ── Manus (Project Hermes — automated deep research; advisory only) ──
  /** Manus API key (open.manus.im). Empty = mission board stays operator-manual. */
  manusApiKey: z.string().default(""),
  manusBaseUrl: z.string().default("https://api.manus.ai"),
  /** Operator preference: max — faster and stronger at working around blocked
   *  tools/login walls (fewer waiting-stalls), at a higher credit cost per task. */
  manusAgentProfile: z.enum(["manus-1.6", "manus-1.6-lite", "manus-1.6-max"]).default("manus-1.6-max"),
  /** Auto-send a Manus mission when a paper BUY opens (deep-research the coins we
   *  actually hold). Off by default — each mission costs Manus credits. */
  manusAutoMissions: z.boolean().default(false),
  /** Hourly cap on AUTO missions (operator-clicked sends are not capped). */
  manusMaxPerHour: z.number().int().min(1).max(60).default(6),
  manusPollSec: z.number().int().min(5).max(300).default(20),
  manusTimeoutMin: z.number().int().min(5).max(180).default(45),
  /** Hermes Phase 3 — recurring Manus DISCOVERY missions: Manus hunts fresh
   *  $50k-500k candidates itself (operator playbook prompt); every returned mint
   *  is injected into the local pipeline for Stage-0 verification + monitoring.
   *  Off by default — each mission costs Manus credits. */
  manusDiscoveryEnabled: z.boolean().default(false),
  manusDiscoveryIntervalMin: z.number().int().min(15).max(1440).default(60),
  /** How many candidates to ask for per discovery mission (operator: "top 5"). */
  manusDiscoveryCandidates: z.number().int().min(3).max(12).default(5),
  /** Auto BATCHED deep-dives: every N minutes, ONE mission reviews all open paper
   *  positions (operator: "ask a bunch at the same time so it's efficient").
   *  0 = off. Runs only when there are open positions and a key is set. */
  manusAutoDeepdiveMin: z.number().int().min(0).max(1440).default(120),

  // ── AI Council (multi-model; advisory only — never overrides safety/risk) ──
  /** Master switch for the OpenCode-routed council seats (GPT-4o/DeepSeek/Qwen…). */
  opencodeEnabled: z.boolean().default(false),
  /** Spawn `opencode serve` ourselves. Default off — on Windows, run it yourself. */
  opencodeAutoServe: z.boolean().default(false),
  opencodePort: z.number().int().min(1).max(65535).default(4096),
  /** Command to spawn when auto-serving (override for a full path / wrapper). */
  opencodeBin: z.string().default("opencode"),
  /** Fallback model for any OpenCode seat that doesn't pin its own. */
  opencodeModel: z.string().default("openai/gpt-4o"),
  /** Local Ollama server — `ollama/*` council seats talk to it directly (tool-less). */
  ollamaBaseUrl: z.string().default("http://127.0.0.1:11434"),
  /** The council roster (seats, roles, providers, models, enabled). */
  councilMembers: z.array(CouncilMemberConfigSchema).default(DEFAULT_COUNCIL),
  /** Run a 2nd "debate" round where local seats react to each other (Council Room chat). */
  councilDebate: z.boolean().default(true),
  /** Always-on Council Room. DEFAULT OFF since the operator's 5,543-opinion
   *  teardown proved the always-on panel carried zero information (49% of all
   *  scores exactly 50; bull seat CONFIRM 98%; 0.7% overlap with actual buys)
   *  while burning ~1k LLM calls/hour. Manus deep-dives are the second-opinion
   *  layer now; flip this on only to use the (restructured) panel deliberately. */
  councilAutoDebate: z.boolean().default(false),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsKey = keyof Settings;

/** Settings keys the learning engine is allowed to suggest/auto-tune. */
export const TUNABLE_KEYS: readonly SettingsKey[] = [
  "minOrganicScore",
  "maxLateEntryRisk",
  "maxTopHolderPct",
  "minConvictionBuySmall",
  "minConvictionBuyStrong",
  "weightOrganic",
  "weightMomentum",
  "weightGraduation",
  "weightDevReputation",
  "weightSmartMoney",
  "weightSocial",
  "weightHype",
];

/** Keys whose VALUES are secrets — redacted before leaving the process. */
export const SECRET_KEYS: readonly SettingsKey[] = [
  "heliusApiKey",
  "birdeyeApiKey",
  "anthropicApiKey",
  "rugcheckApiKey",
  "lunarcrushApiKey",
  "manusApiKey",
];

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}

export class SettingsStore {
  private cache?: Settings;

  constructor(private readonly db: DB) {}

  /** All settings, merged over defaults and validated. Cached. */
  all(): Settings {
    if (this.cache) return this.cache;
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as {
      key: string;
      value: string;
    }[];
    const raw: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        raw[r.key] = JSON.parse(r.value);
      } catch {
        /* ignore malformed row; default fills in */
      }
    }
    // PER-KEY salvage (V5.1 red-team fix): validate each stored key individually
    // and drop ONLY the invalid ones. Previously one bad row (e.g. Infinity
    // serialized as "null") failed the whole-object parse and silently reset
    // EVERY setting to defaults on the next boot.
    const shape = SettingsSchema.shape as Record<string, z.ZodTypeAny>;
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      const s = shape[k];
      if (!s) continue; // unknown key — dropped
      const r = s.safeParse(v);
      if (r.success) cleaned[k] = r.data;
    }
    const parsed = SettingsSchema.safeParse(cleaned);
    this.cache = parsed.success ? parsed.data : defaultSettings();
    return this.cache;
  }

  get<K extends SettingsKey>(key: K): Settings[K] {
    return this.all()[key];
  }

  /**
   * Apply a partial update. Writes only changed keys, logs each to
   * setting_change_log, and returns the changes. `by` distinguishes manual
   * applies from bounded auto-tune.
   */
  update(
    partial: Partial<Settings>,
    by: "user" | "auto" = "user",
    note?: string,
  ): SettingChange[] {
    const current = this.all();
    // Non-finite numbers (Infinity via JSON "1e999") serialize as "null" and used
    // to corrupt the store — reject them outright (V5.1 red-team fix).
    for (const [k, v] of Object.entries(partial)) {
      if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`setting ${k} must be a finite number`);
    }
    // Validate the merged object so we never persist an out-of-range value.
    const merged = SettingsSchema.parse({ ...current, ...partial });
    const now = Date.now();
    const changes: SettingChange[] = [];

    const writeSetting = this.db.prepare(
      "INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
    );
    const logChange = this.db.prepare(
      "INSERT INTO setting_change_log(at, setting, from_val, to_val, by, note) VALUES (?,?,?,?,?,?)",
    );

    const tx = this.db.transaction(() => {
      for (const key of Object.keys(partial) as SettingsKey[]) {
        const before = current[key];
        const after = merged[key];
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        writeSetting.run(key, JSON.stringify(after), now);
        logChange.run(
          now,
          key,
          String(before),
          String(after),
          by,
          note ?? null,
        );
        changes.push({ at: now, setting: key, from: before as never, to: after as never, by, note });
      }
    });
    tx();

    this.cache = merged;
    return changes;
  }

  /** Wipe all settings back to defaults (e.g. a hard reset). */
  reset(): void {
    this.db.prepare("DELETE FROM settings").run();
    this.cache = undefined;
  }

  /** Settings safe to send to the browser — secret values become booleans. */
  redacted(): Record<string, unknown> {
    const all = this.all() as Record<string, unknown>;
    const out: Record<string, unknown> = { ...all };
    for (const k of SECRET_KEYS) {
      out[k] = typeof all[k] === "string" && (all[k] as string).length > 0;
    }
    return out;
  }
}
