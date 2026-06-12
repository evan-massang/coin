import { Router } from "express";
import type { Services } from "../services.js";

// RESEARCH CAM routes — initial state for first paint (live updates arrive over
// the websocket "browsercam" channel) + a manual dive trigger so the operator
// can watch the research browser work on demand. Read-only research; the dive
// goes through the normal attention queue → rescore → decide() (gated as ever).
export function camRoutes(svc: Services): Router {
  const r = Router();

  r.get("/browsercam", (_req, res) => {
    res.json({ ok: true, ...(svc.cam?.state() ?? { status: "idle", actions: [] }), browserEnabled: svc.settings.get("attentionUseBrowser") });
  });

  r.post("/browsercam/dive", (req, res) => {
    if (!svc.attention) {
      res.status(503).json({ ok: false, error: "engine not running (NO_ENGINE mode)" });
      return;
    }
    const body = (req.body ?? {}) as { mint?: string };
    let mint = body.mint;
    let symbol: string | undefined;
    let name: string | undefined;
    if (mint) {
      const t = svc.tokens.get(mint);
      symbol = t?.symbol;
      name = t?.name;
    } else {
      // No mint given → dive on the most recent non-AVOID signal.
      const recent = svc.signals.recent(30).find((s) => s.verdict !== "AVOID");
      if (!recent) {
        res.status(404).json({ ok: false, error: "no recent coin to dive on" });
        return;
      }
      mint = recent.mint;
      symbol = recent.symbol;
      const t = svc.tokens.get(mint);
      name = t?.name;
    }
    svc.attention.request({ mint, symbol, name, verdict: "operator-dive" }, true);
    res.json({ ok: true, mint, symbol, queued: svc.attention.queueLength });
  });

  return r;
}
