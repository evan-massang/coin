import { describe, it, expect } from "vitest";
import { validateDataTruth, type DataTruthInputs } from "./dataTruthValidator.js";
import type { PaperStats } from "../paper/paperPnL.js";

// A self-consistent ground-truth stats block: cash 30 + open 8 = equity 38 (= start),
// total 0, realized -1 + unrealized +1 = 0.
function stats(over: Partial<PaperStats> = {}): PaperStats {
  return {
    balanceSol: 30, startingBalanceSol: 38, openValueSol: 8, equitySol: 38,
    realizedPnlSol: -1, unrealizedPnlSol: 1, totalPnlSol: 0,
    openCount: 5, closedCount: 3, winRate: 0.33, bestTradePct: 100, worstTradePct: -50, avgHoldMs: 1000,
    ...over,
  };
}

function inputs(over: Partial<DataTruthInputs> = {}): DataTruthInputs {
  return {
    stats: stats(),
    ledgerRealizedSol: -1, // matches cash-derived realized
    signals: [{ conviction: 60, pairCreatedAt: 1_700_000_000_000 }, { conviction: 40 }],
    attentionFeedCount: 10,
    attentionDbCount: 30,
    ...over,
  };
}

describe("validateDataTruth (Phase 0)", () => {
  it("passes when every source reconciles", () => {
    const r = validateDataTruth(inputs());
    expect(r.ok).toBe(true);
    expect(r.checks.every((c) => c.status === "PASS")).toBe(true);
  });

  it("FAILs the equity identity when accounting doesn't close", () => {
    const r = validateDataTruth(inputs({ stats: stats({ equitySol: 99 }) }));
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "equity = cash + openValue")?.status).toBe("FAIL");
  });

  it("WARNs (not FAILs) when the per-fill ledger drifts from cash-derived realized", () => {
    // The partial-sell cost-basis bug regressed: ledger says -5, cash says -1.
    const r = validateDataTruth(inputs({ ledgerRealizedSol: -5 }));
    expect(r.ok).toBe(true); // WARN doesn't fail the report — cash stays source of truth
    const c = r.checks.find((x) => x.name === "per-fill ledger vs cash-derived realized")!;
    expect(c.status).toBe("WARN");
    expect(c.detail).toContain("Δ");
  });

  it("FAILs a conviction outside [0,100]", () => {
    const r = validateDataTruth(inputs({ signals: [{ conviction: 142 }] }));
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "conviction in [0,100]")?.status).toBe("FAIL");
  });

  it("WARNs when signals exist but none carry a true coin age (capture broke)", () => {
    const r = validateDataTruth(inputs({ signals: [{ conviction: 50 }, { conviction: 60 }] }));
    expect(r.checks.find((c) => c.name.startsWith("AGE column provenance"))?.status).toBe("WARN");
  });

  it("WARNs when the attention feed claims more rows than the durable store holds", () => {
    const r = validateDataTruth(inputs({ attentionFeedCount: 50, attentionDbCount: 30 }));
    expect(r.checks.find((c) => c.name === "attention feed within durable store")?.status).toBe("WARN");
  });
});
