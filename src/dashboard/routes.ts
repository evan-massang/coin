import { Router } from "express";
import type { Services } from "../services.js";
import { metrics } from "../util/metrics.js";
import { buildLinks } from "../alerts/templates.js";
import { getMarketMacro } from "../sources/coingecko.js";
import { fetchMarketWeather } from "../agents/marketWeather.js";
import { classifyRegime } from "../graph/marketRegime.js";
import { buildReasoningFeed, buildReasoningReport } from "./reasoning.js";

/** Core read API: status, journal/signals, positions, tokens. */
export function coreRoutes(svc: Services): Router {
  const r = Router();

  r.get("/status", (_req, res) => {
    const s = svc.settings.all();
    res.json({
      ok: true,
      at: Date.now(),
      modes: {
        liveSignal: true,
        walletObserver: s.walletObserverEnabled,
        paperTrading: s.paperEnabled,
      },
      learningMode: s.learningMode,
      wallet: {
        address: s.walletAddress,
        enabled: s.walletObserverEnabled,
        connected: svc.runtime.wallet.connected,
        lastCheckedMs: svc.runtime.wallet.lastCheckedMs,
        error: svc.runtime.wallet.error,
      },
      counts: {
        tokens: svc.tokens.count(),
        signals: svc.signals.stats().total,
        openPositions: svc.positions.byStatus(true).length,
      },
      wsClients: svc.hub.clientCount,
      metrics: metrics.snapshot(),
    });
  });

  // §1.10 journal — every signal, newest first, with deeplinks attached.
  r.get("/signals", (req, res) => {
    const limit = clampInt(req.query.limit, 200, 1, 1000);
    const verdict = typeof req.query.verdict === "string" ? req.query.verdict : undefined;
    const rows = svc.signals.recent(limit).filter((s) => !verdict || s.verdict === verdict);
    res.json(rows.map((s) => ({ ...s, links: buildLinks(s.mint) })));
  });

  r.get("/journal/stats", (_req, res) => {
    res.json(svc.signals.stats());
  });

  // Live "Reasoning Feed": merged, newest-first stream of WHY the engine + AI
  // council bought / sold / avoided each coin (powers the dashboard panel).
  r.get("/reasoning", (req, res) => {
    const limit = clampInt(req.query.limit, 60, 1, 300);
    res.json({ feed: buildReasoningFeed(svc, limit) });
  });

  // Same content as a downloadable plain-text report (the "Download report" button).
  r.get("/reasoning/report", (req, res) => {
    const limit = clampInt(req.query.limit, 80, 1, 500);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="coin-ai-reasoning-${stamp}.txt"`);
    res.send(buildReasoningReport(svc, limit));
  });

  // Market weather + macro (SOL/BTC 24h) + classified regime for the regime panel.
  r.get("/market", async (_req, res) => {
    const s = svc.settings.all();
    const macro: { solChange24h?: number; btcChange24h?: number } = await getMarketMacro().catch(() => ({}));
    const weather = await fetchMarketWeather(
      () => {
        // REAL trades only (resolved BUYs) — must match entry.ts. Using the
        // all-signal win-rate here poisons the panel into a false RISK_OFF and
        // (via the runtime write below) clobbers the council's regime (Cycle 5).
        const bs = svc.signals.buyStats();
        return { winRate: bs.winRate, samples: bs.samples };
      },
      s.riskOffMultiplier,
      undefined,
      s.minWeatherSamples,
    ).catch(() => ({ weather: "NEUTRAL" as const, multiplier: 1, reasons: [] }));
    const st = svc.signals.stats();
    const buys = (st.byVerdict.BUY_SMALL ?? 0) + (st.byVerdict.BUY_STRONG ?? 0);
    const regime = classifyRegime({
      weather: weather.weather,
      solChange24h: macro.solChange24h,
      btcChange24h: macro.btcChange24h,
      buyRate: st.total ? buys / st.total : 0,
      avoidRate: st.total ? (st.byVerdict.AVOID ?? 0) / st.total : 0,
    });
    svc.runtime.marketRegime = regime.regime; // share with the AI council
    res.json({ weather: weather.weather, multiplier: weather.multiplier, reasons: weather.reasons, regime, ...macro });
  });

  // Engine-state tiles: what the engine is doing right now (Observing / Decision
  // Ready / High Conviction / High Risk) — the top of the operator dashboard.
  r.get("/engine-state", (_req, res) => {
    res.json({ ...svc.runtime.engineState, intelCount: svc.runtime.intel.size, at: Date.now() });
  });

  // Full graph intelligence for one token: entities, bull/bear evidence, coverage,
  // observation state, "why", timeline. Powers the "Why This Token?" panel.
  r.get("/token/:mint", (req, res) => {
    const intel = svc.runtime.intel.get(req.params.mint);
    if (!intel) {
      res.status(404).json({ error: "no intel for mint (not yet scored or evicted)", mint: req.params.mint });
      return;
    }
    res.json({ ...intel, links: buildLinks(intel.mint) });
  });

  // Just the entity graph for one token (investigation center).
  r.get("/graph/:mint", (req, res) => {
    const intel = svc.runtime.intel.get(req.params.mint);
    if (!intel) {
      res.status(404).json({ error: "no intel for mint", mint: req.params.mint });
      return;
    }
    res.json({ mint: intel.mint, symbol: intel.symbol, state: intel.state, entities: intel.entities });
  });

  // Wallet observer tab: status + detected positions with live PnL.
  r.get("/wallet", (_req, res) => {
    const open = svc.positions.byStatus(true);
    res.json({
      status: svc.runtime.wallet,
      enabled: svc.settings.get("walletObserverEnabled"),
      positions: open.map((p) => ({ ...p, links: buildLinks(p.mint) })),
    });
  });

  // Positions for the Open/Closed tabs.
  r.get("/positions", (req, res) => {
    const open = req.query.status !== "closed";
    const rows = svc.positions.byStatus(open);
    res.json(rows.map((p) => ({ ...p, links: buildLinks(p.mint) })));
  });

  return r;
}

function clampInt(v: unknown, def: number, lo: number, hi: number): number {
  const n = typeof v === "string" ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, n));
}
