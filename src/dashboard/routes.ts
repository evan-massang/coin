import { Router } from "express";
import type { Services } from "../services.js";
import { metrics } from "../util/metrics.js";
import { buildLinks } from "../alerts/templates.js";
import { getMarketMacro } from "../sources/coingecko.js";
import { fetchMarketWeather } from "../agents/marketWeather.js";
import { classifyRegime } from "../graph/marketRegime.js";
import { buildReasoningFeed, buildReasoningReport } from "./reasoning.js";
import { computePaperStats } from "../paper/paperPnL.js";
import { validateDataTruth } from "../debug/dataTruthValidator.js";
import { auditAuthority, type AuthorityResearch } from "../debug/authorityAudit.js";

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

  // Phase 0 Data Truth: a standing provenance check — equity/PnL identities, the
  // per-fill ledger vs cash-derived realized reconciliation, conviction range, coin-age
  // capture health, and attention feed-vs-store consistency. Surfaces drift; never hides.
  r.get("/data-truth", (_req, res) => {
    const open = svc.paperPositions.byStatus(true);
    const closed = svc.paperPositions.byStatus(false);
    const stats = computePaperStats(svc.paper.get(), open, closed, svc.paper.realizedPnlSol());
    const signals = svc.signals.recent(120).map((s) => ({ conviction: s.conviction, pairCreatedAt: s.pairCreatedAt }));
    const report = validateDataTruth({
      stats,
      ledgerRealizedSol: svc.paper.realizedPnlSol(),
      signals,
      attentionFeedCount: svc.attention?.recent(120).length ?? 0,
      attentionDbCount: svc.attentionRepo.count(),
    });
    res.json({ at: Date.now(), ...report });
  });

  // Phase 17/22 Decision Authority: per executed paper buy, which intelligence backed
  // it; plus THE invariant — when the Readiness Gate is on, no buy bypasses attention
  // (the legacy pre-research scored_BUY_* counter must be 0). Proves Athena gates buys.
  r.get("/authority", (_req, res) => {
    const s = svc.settings.all();
    const gateOn = s.attentionReadinessGate && s.attentionEnabled && s.weightAttention > 0;
    const positions = [...svc.paperPositions.byStatus(true), ...svc.paperPositions.byStatus(false)]
      .sort((a, b) => b.entryAtMs - a.entryAtMs)
      .slice(0, 60);
    const buys = positions.map((p) => ({ mint: p.mint, symbol: p.symbol, entryAtMs: p.entryAtMs }));
    const research = new Map<string, AuthorityResearch>();
    for (const b of buys) {
      const rec = svc.attentionRepo.get(b.mint);
      if (rec) research.set(b.mint, { at: rec.at, attention: rec.scores.attention, confidence: rec.scores.confidence });
    }
    const counters = metrics.snapshot().counters;
    const report = auditAuthority({
      gateOn,
      buys,
      research,
      counters: {
        scoredBuys: (counters.scored_BUY_SMALL ?? 0) + (counters.scored_BUY_STRONG ?? 0),
        attentionGatedBuys: counters.attention_gated_buy ?? 0,
      },
    });
    res.json({ at: Date.now(), ...report });
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

  // Attention Intelligence (Project Athena): the researched "graveyard" + per-coin
  // evidence drill-down — so every attention score is inspectable (Phase 15).
  r.get("/attention", (req, res) => {
    const limit = clampInt(req.query.limit, 60, 1, 500);
    res.json(
      svc.attentionRepo.recent(limit).map((rec) => ({
        mint: rec.mint,
        symbol: rec.evidence.symbol,
        name: rec.evidence.name,
        at: rec.at,
        source: rec.source,
        scores: {
          attention: rec.scores.attention,
          humanity: rec.scores.humanity,
          virality: rec.scores.virality,
          outsideCrypto: rec.scores.outsideCrypto,
          culturalStrength: rec.scores.culturalStrength,
          confidence: rec.scores.confidence,
        },
        narrative: rec.scores.narrative,
        platforms: rec.evidence.platforms,
        postsCount: rec.evidence.posts.length,
      })),
    );
  });

  // Full evidence for one coin — inspect WHY its attention score is what it is.
  r.get("/attention/:mint", (req, res) => {
    const rec = svc.attention?.record(req.params.mint) ?? svc.attentionRepo.get(req.params.mint);
    if (!rec) {
      res.status(404).json({ error: "not researched yet" });
      return;
    }
    res.json({ mint: rec.mint, at: rec.at, source: rec.source, scores: rec.scores, evidence: rec.evidence });
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
