import { Router } from "express";
import type { Services } from "../services.js";
import { TUNABLE_KEYS } from "../store/settingsStore.js";
import { runBacktest, type HistSignal } from "../learning/backtester.js";
import { thresholdsFromSettings } from "../scoring/thresholds.js";

// Learning tab API (§1.12): suggestions with Apply/Ignore, learning-mode toggle,
// and the setting-change history. Backtest run is wired in Phase 8.
export function learningRoutes(svc: Services): Router {
  const r = Router();

  r.get("/learning", (_req, res) => {
    res.json({
      mode: svc.settings.get("learningMode"),
      pending: svc.learning.pendingSuggestions(),
      history: svc.learning.changeLog(100),
      backtests: svc.learning.backtests(20),
    });
  });

  r.post("/learning/mode", (req, res) => {
    const mode = req.body?.mode;
    if (mode !== "manual" && mode !== "auto") {
      res.status(400).json({ ok: false, error: "mode must be 'manual' or 'auto'" });
      return;
    }
    svc.settings.update({ learningMode: mode }, "user");
    svc.hub.broadcast("settings", svc.settings.redacted());
    res.json({ ok: true, mode });
  });

  // Apply a suggestion: write the setting (user-authorized) and mark it applied.
  r.post("/learning/suggestions/:id/apply", (req, res) => {
    const id = Number(req.params.id);
    const sug = svc.learning.getSuggestion(id);
    if (!sug) {
      res.status(404).json({ ok: false, error: "suggestion not found" });
      return;
    }
    if (!isNumericSettingKey(sug.setting)) {
      res.status(400).json({ ok: false, error: `not an applyable setting: ${sug.setting}` });
      return;
    }
    svc.settings.update({ [sug.setting]: sug.to } as never, "user", `applied suggestion #${id}`);
    svc.learning.setSuggestionStatus(id, "applied");
    svc.hub.broadcast("settings", svc.settings.redacted());
    res.json({ ok: true });
  });

  r.post("/learning/suggestions/:id/ignore", (req, res) => {
    const id = Number(req.params.id);
    svc.learning.setSuggestionStatus(id, "ignored");
    res.json({ ok: true });
  });

  // §1.13 Backtest: replay journalled signals under alternative thresholds.
  r.post("/backtest", (req, res) => {
    const overrides = (req.body?.overrides ?? {}) as Record<string, number>;
    const base = thresholdsFromSettings(svc.settings.all());
    const thresholds = {
      ...base,
      minConvictionBuySmall: num(overrides.minConvictionBuySmall, base.minConvictionBuySmall),
      minConvictionBuyStrong: num(overrides.minConvictionBuyStrong, base.minConvictionBuyStrong),
      minOrganicScore: num(overrides.minOrganicScore, base.minOrganicScore),
      maxLateEntryRisk: num(overrides.maxLateEntryRisk, base.maxLateEntryRisk),
    };

    const signals: HistSignal[] = svc.signals
      .recent(2000)
      .filter((s) => s.priceAtAlert && s.maxGainPct != null)
      .map((s) => ({
        scores: s.scores,
        safetyPass: s.scores.safety > 0,
        unknownCount: s.flags.includes("safety-unknowns") ? 2 : 0,
        maxGainPct: s.maxGainPct,
        maxDrawdownPct: s.maxDrawdownPct,
      }));

    if (signals.length === 0) {
      res.json({ ok: false, error: "No resolved signals yet — let the engine run a soak first." });
      return;
    }

    const result = runBacktest(signals, thresholds);
    svc.learning.addBacktest({ at: Date.now(), settings: overrides, ...result });
    svc.hub.broadcast("learning", { backtest: true });
    res.json({ ok: true, result });
  });

  return r;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

const NUMERIC_KEYS = new Set<string>(TUNABLE_KEYS);

function isNumericSettingKey(key: string): boolean {
  // Suggestions only ever target the (numeric) tunable keys.
  return NUMERIC_KEYS.has(key);
}
