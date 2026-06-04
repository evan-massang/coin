import { z } from "zod";
import type { DB } from "./db.js";
import type { SettingChange } from "../types.js";

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
  maxHoldMinutes: z.number().min(1).default(240),
  minLiquidityUsd: z.number().min(0).default(3000),

  // ── Paper trading (Mode 3 — simulation only) ──
  paperEnabled: z.boolean().default(false),
  paperStartingBalanceSol: z.number().min(0).default(10),
  paperMaxPositionSol: z.number().min(0).default(1),
  paperRiskPerTradePct: z.number().min(0).max(100).default(3),
  /** Assumed slippage + fee on paper fills, for realism. */
  paperSlippagePct: z.number().min(0).max(100).default(2),

  // ── MicroFish dynamic risk sizing (advisory / paper-only) ──
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
  minConvictionBuySmall: z.number().min(0).max(100).default(55),
  minConvictionBuyStrong: z.number().min(0).max(100).default(72),

  // ── Conviction weights (tunable by learning, within rails) ──
  weightOrganic: z.number().min(0).default(15),
  weightMomentum: z.number().min(0).default(30),
  weightGraduation: z.number().min(0).default(12),
  weightDevReputation: z.number().min(0).default(12),
  weightSmartMoney: z.number().min(0).default(18),
  weightSocial: z.number().min(0).default(8),
  /** AI narrative weight — kept small; confirmation only. */
  weightHype: z.number().min(0).default(5),

  // ── Optional API keys (free tiers; all optional) ──
  heliusApiKey: z.string().default(""),
  birdeyeApiKey: z.string().default(""),
  anthropicApiKey: z.string().default(""),
  rugcheckApiKey: z.string().default(""),
  lunarcrushApiKey: z.string().default(""),
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
    // Unknown/missing keys fall back to schema defaults; bad values are dropped.
    const parsed = SettingsSchema.safeParse(raw);
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
