import type { PaperStats } from "../paper/paperPnL.js";

// Project Athena Phase 0 — Data Truth Validation. A STANDING guard (not a one-shot
// audit) that re-checks the highest-risk provenance invariants the data-truth audit
// surfaced, so the fixes can't silently regress. Every check compares INDEPENDENT
// sources (cash vs ledger, signal vs range, feed vs durable store) and is pure +
// testable; the route feeds it live repo data.

export type TruthStatus = "PASS" | "WARN" | "FAIL";

export interface TruthCheck {
  name: string;
  status: TruthStatus;
  /** Human-readable observed-vs-expected so a WARN/FAIL is self-explaining. */
  detail: string;
}

export interface DataTruthInputs {
  /** Cash-derived ground-truth accounting (computePaperStats). */
  stats: PaperStats;
  /** Sum of the per-fill paper_trades.realized_pnl_sol ledger (the drift-prone one). */
  ledgerRealizedSol: number;
  /** Recent journalled signals — only the fields we validate. */
  signals: { conviction: number; pairCreatedAt?: number }[];
  /** Attention rows surfaced in the reasoning feed vs the durable store count. */
  attentionFeedCount: number;
  attentionDbCount: number;
}

export interface DataTruthReport {
  ok: boolean; // no FAILs (WARN is allowed — it surfaces known/benign drift)
  checks: TruthCheck[];
}

const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

/** Run all provenance invariants. Pure — caller stamps the timestamp. */
export function validateDataTruth(i: DataTruthInputs): DataTruthReport {
  const checks: TruthCheck[] = [];
  const s = i.stats;

  // 1. Equity identity — the ground-truth accounting must close.
  {
    const lhs = s.balanceSol + s.openValueSol;
    checks.push({
      name: "equity = cash + openValue",
      status: near(lhs, s.equitySol, 1e-6) ? "PASS" : "FAIL",
      detail: `cash ${s.balanceSol.toFixed(4)} + open ${s.openValueSol.toFixed(4)} = ${lhs.toFixed(4)} vs equity ${s.equitySol.toFixed(4)}`,
    });
  }

  // 2. Total identity — total PnL is exactly equity minus the starting balance.
  {
    const lhs = s.equitySol - s.startingBalanceSol;
    checks.push({
      name: "totalPnl = equity - start",
      status: near(lhs, s.totalPnlSol, 1e-6) ? "PASS" : "FAIL",
      detail: `${lhs.toFixed(4)} vs total ${s.totalPnlSol.toFixed(4)}`,
    });
  }

  // 3. Split identity — realized + unrealized reconstructs total.
  {
    const lhs = s.realizedPnlSol + s.unrealizedPnlSol;
    checks.push({
      name: "realized + unrealized = total",
      status: near(lhs, s.totalPnlSol, 1e-6) ? "PASS" : "FAIL",
      detail: `realized ${s.realizedPnlSol.toFixed(4)} + unrealized ${s.unrealizedPnlSol.toFixed(4)} = ${lhs.toFixed(4)} vs total ${s.totalPnlSol.toFixed(4)}`,
    });
  }

  // 4. PnL ledger reconciliation — the per-fill realized_pnl_sol ledger (still read by
  //    the reasoning feed) must equal the cash-derived realized. A drift means the
  //    partial-sell cost-basis bug is back; WARN (not FAIL) since cash stays the source
  //    of truth and the dashboard total is unaffected — but we surface it, never hide it.
  {
    const diff = Math.abs(i.ledgerRealizedSol - s.realizedPnlSol);
    checks.push({
      name: "per-fill ledger vs cash-derived realized",
      status: diff <= 0.01 ? "PASS" : "WARN",
      detail: `ledger ${i.ledgerRealizedSol.toFixed(4)} vs cash ${s.realizedPnlSol.toFixed(4)} (Δ ${diff.toFixed(4)} SOL)`,
    });
  }

  // 5. Conviction range — every displayed/journalled conviction is a 0..100 score.
  {
    const bad = i.signals.filter((x) => !(x.conviction >= 0 && x.conviction <= 100));
    checks.push({
      name: "conviction in [0,100]",
      status: bad.length ? "FAIL" : "PASS",
      detail: bad.length ? `${bad.length}/${i.signals.length} out of range` : `${i.signals.length} signals in range`,
    });
  }

  // 6. AGE provenance — confirms the coin-age capture is actually populating. If there
  //    are signals but ZERO carry a true pairCreatedAt, the capture likely broke (the
  //    column would silently fall back to recency everywhere) ⇒ WARN.
  {
    const trueAge = i.signals.filter((x) => typeof x.pairCreatedAt === "number" && x.pairCreatedAt > 0).length;
    checks.push({
      name: "AGE column provenance (true coin age present)",
      status: i.signals.length > 0 && trueAge === 0 ? "WARN" : "PASS",
      detail: `${trueAge}/${i.signals.length} signals carry true coin age; rest honestly show ~recency`,
    });
  }

  // 7. Attention feed ⊆ durable store — the feed must not invent rows the store lacks.
  {
    checks.push({
      name: "attention feed within durable store",
      status: i.attentionFeedCount <= i.attentionDbCount ? "PASS" : "WARN",
      detail: `feed ${i.attentionFeedCount} vs durable ${i.attentionDbCount}`,
    });
  }

  return { ok: !checks.some((c) => c.status === "FAIL"), checks };
}
