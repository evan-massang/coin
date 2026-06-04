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
