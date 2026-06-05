import { Router } from "express";
import type { Services } from "../services.js";
import type { Position } from "../types.js";
import { buildLinks } from "../alerts/templates.js";
import { computePaperStats } from "../paper/paperPnL.js";

// Paper Wallet tab API (Mode 3). Simulation only — these endpoints never touch
// a key, never sign, never go on-chain.
export function paperRoutes(svc: Services): Router {
  const r = Router();

  r.get("/paper", (_req, res) => {
    const s = svc.settings.all();
    // Self-heal: if paper is enabled but the sim wallet was never created, make
    // it now at the configured starting balance (so the UI shows it, not 0).
    if (s.paperEnabled && !svc.paper.get()) svc.paper.ensure(s.paperStartingBalanceSol);
    const wallet = svc.paper.get();
    const open = svc.paperPositions.byStatus(true);
    const closed = svc.paperPositions.byStatus(false);
    res.json({
      enabled: s.paperEnabled,
      startingBalanceSol: s.paperStartingBalanceSol,
      wallet,
      open: open.map(withLinks),
      closed: closed.map(withLinks),
      fills: svc.paper.fills(100),
      stats: computePaperStats(svc.paper.get(), open, closed, svc.paper.realizedPnlSol()),
    });
  });

  // Profit x Time series: per owned paper position, the PnL% trajectory from the
  // moment it was bought (point 0 = entry = 0%). Open + recently-closed (<=3h).
  r.get("/paper/series", (_req, res) => {
    const now = Date.now();
    const open = svc.paperPositions.byStatus(true);
    const closed = svc.paperPositions.byStatus(false).filter((p) => (p.closedAtMs ?? 0) > now - 3 * 60 * 60_000);
    // Most-recent ~40 by buy time — open positions always kept; keeps the chart
    // legible and the payload small (pan/zoom explores the rest of the window).
    const positions = [...open, ...closed].sort((a, b) => b.entryAtMs - a.entryAtMs).slice(0, 40);
    const samples = svc.paper.samplesForPositions(positions.map((p) => p.id));
    res.json({
      now,
      positions: positions.map((p) => {
        const pts = samples.get(p.id) ?? [];
        // Always anchor the line at 0% on the buy timestamp.
        const points = [{ t: p.entryAtMs, pnl: 0 }, ...pts];
        const curPnl = p.entryPriceUsd > 0 && p.lastPriceUsd ? (p.lastPriceUsd / p.entryPriceUsd - 1) * 100 : 0;
        return {
          id: p.id,
          mint: p.mint,
          symbol: p.symbol ?? p.mint.slice(0, 5),
          entryAtMs: p.entryAtMs,
          status: p.status,
          closedAtMs: p.closedAtMs ?? null,
          curPnl,
          points,
        };
      }),
    });
  });

  // Reset the sim wallet to the configured starting balance.
  r.post("/paper/reset", (_req, res) => {
    const starting = svc.settings.get("paperStartingBalanceSol");
    svc.paper.reset(starting);
    svc.hub.broadcast("paper", { reset: true });
    res.json({ ok: true, wallet: svc.paper.get() });
  });

  return r;
}

function withLinks(p: Position): Position & { links: ReturnType<typeof buildLinks> } {
  return { ...p, links: buildLinks(p.mint) };
}
