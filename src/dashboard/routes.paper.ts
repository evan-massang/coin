import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import type { Services } from "../services.js";
import type { Position } from "../types.js";
import { buildLinks } from "../alerts/templates.js";
import { computePaperStats } from "../paper/paperPnL.js";
import { config } from "../config.js";

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
    // P0: closed rows carry their durable-journal record (exit reason, dd@5m,
    // realized SOL) so the UI shows WHY each trade ended, not just the PnL.
    const journal = svc.realized.forPositions(closed.map((p) => p.id));
    const stats = computePaperStats(wallet, open, closed, svc.paper.realizedPnlSol());
    const sinceReset = svc.realized.lastResetAt() ?? 0;
    const ledger = svc.realized.totals(sinceReset);
    res.json({
      enabled: s.paperEnabled,
      startingBalanceSol: s.paperStartingBalanceSol,
      wallet,
      open: open.map(withLinks),
      closed: closed.map((p) => {
        const j = journal.get(p.id);
        return {
          ...withLinks(p),
          exitReason: j?.exitReason,
          dd5mPct: j?.dd5mPct,
          realizedPnlSol: j?.realizedPnlSol,
          holdMs: j?.holdMs,
        };
      }),
      fills: svc.paper.fills(100),
      stats,
      // One PnL source of truth (P0): the durable ledger for the CURRENT wallet
      // generation, plus the reconciliation delta vs the cash-derived stats.
      // statsRealized ties to real cash by construction; ledgerRealized is the
      // sum of journaled round-trips. They should agree within fill rounding.
      ledger: {
        ...ledger,
        sinceReset,
        allTime: svc.realized.totals(0),
        reconcileDeltaSol: ledger.realizedPnlSol - stats.realizedPnlSol,
      },
    });
  });

  // P0: realized equity curve — cumulative realized SOL per closed trade, from
  // the durable journal (survives resets; pass ?all=1 for the full history).
  r.get("/paper/equity", (req, res) => {
    const all = req.query.all === "1";
    const since = all ? 0 : svc.realized.lastResetAt() ?? 0;
    res.json({ since, curve: svc.realized.equityCurve(since) });
  });

  // Reset the sim wallet to the configured starting balance.
  // P0 guard: requires explicit confirm + auto-exports the full paper state
  // first (a reset destroyed 253 positions mid-audit; never again silently).
  r.post("/paper/reset", (req, res) => {
    const confirmed = Boolean((req.body as { confirm?: boolean } | undefined)?.confirm);
    if (!confirmed) {
      res.status(400).json({
        ok: false,
        error: "reset requires {\"confirm\":true} — it wipes the sim wallet, positions and fills (the durable realized journal is kept)",
      });
      return;
    }
    const now = Date.now();
    const wallet = svc.paper.get();
    const open = svc.paperPositions.byStatus(true);
    const closed = svc.paperPositions.byStatus(false);
    const stats = computePaperStats(wallet, open, closed, svc.paper.realizedPnlSol());
    let exportPath: string | undefined;
    try {
      const dir = path.join(config.dataDir, "exports");
      fs.mkdirSync(dir, { recursive: true });
      exportPath = path.join(dir, `paper-reset-${new Date(now).toISOString().replace(/[:.]/g, "-")}.json`);
      fs.writeFileSync(
        exportPath,
        JSON.stringify({ at: now, wallet, stats, open, closed, fills: svc.paper.allFills() }, null, 2),
      );
    } catch {
      exportPath = undefined; // export failure must not block the reset; it IS logged below
    }
    svc.realized.recordReset({
      at: now,
      exportPath,
      balanceSol: wallet?.balanceSol,
      startingBalanceSol: wallet?.startingBalanceSol,
      equitySol: stats.equitySol,
      openCount: open.length,
      closedCount: closed.length,
      fillsCount: svc.paper.fillsCount(),
    });
    const starting = svc.settings.get("paperStartingBalanceSol");
    svc.paper.reset(starting);
    svc.hub.broadcast("paper", { reset: true });
    res.json({ ok: true, wallet: svc.paper.get(), exportPath });
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

  return r;
}

function withLinks(p: Position): Position & { links: ReturnType<typeof buildLinks> } {
  return { ...p, links: buildLinks(p.mint) };
}
