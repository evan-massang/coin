import type { Services } from "../services.js";
import { metrics } from "../util/metrics.js";
import { computePaperStats } from "../paper/paperPnL.js";
import { validateDataTruth, type DataTruthReport } from "./dataTruthValidator.js";
import { auditAuthority, type AuthorityReport, type AuthorityResearch } from "./authorityAudit.js";

// Project Athena Phase 15 — one automated audit that rolls up the standing checks
// (data-truth provenance + decision authority) into a single PASS/WARN/FAIL verdict.
// Surfaced at /api/athena-audit and logged periodically so an overnight run is
// grep-able: any FAIL means an accounting identity broke or a buy bypassed the gate.

export type AuditStatus = "PASS" | "WARN" | "FAIL";

export interface AthenaAuditReport {
  at: number;
  status: AuditStatus;
  failures: string[];
  warnings: string[];
  dataTruth: DataTruthReport;
  authority: AuthorityReport;
}

/** Pure roll-up: derive the overall verdict + flat warning/failure lists from the two
 *  sub-reports. FAIL dominates WARN dominates PASS. Testable without a live engine. */
export function combineAthenaAudit(dataTruth: DataTruthReport, authority: AuthorityReport, at: number): AthenaAuditReport {
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const c of dataTruth.checks) {
    if (c.status === "FAIL") failures.push(`data-truth/${c.name}: ${c.detail}`);
    else if (c.status === "WARN") warnings.push(`data-truth/${c.name}: ${c.detail}`);
  }
  if (!authority.noSilentBypass) {
    failures.push(`authority/no-silent-bypass: ${authority.counters.scoredBuys} buy(s) skipped attention while the gate is on`);
  }
  const status: AuditStatus = failures.length ? "FAIL" : warnings.length ? "WARN" : "PASS";
  return { at, status, failures, warnings, dataTruth, authority };
}

/** Gather live inputs from the services and run the full audit. */
export function runAthenaAudit(svc: Services, now: number): AthenaAuditReport {
  const open = svc.paperPositions.byStatus(true);
  const closed = svc.paperPositions.byStatus(false);
  const stats = computePaperStats(svc.paper.get(), open, closed, svc.paper.realizedPnlSol());
  const signals = svc.signals.recent(120).map((s) => ({ conviction: s.conviction, pairCreatedAt: s.pairCreatedAt }));
  const dataTruth = validateDataTruth({
    stats,
    ledgerRealizedSol: svc.paper.realizedPnlSol(),
    signals,
    attentionFeedCount: svc.attention?.recent(120).length ?? 0,
    attentionDbCount: svc.attentionRepo.count(),
  });

  const s = svc.settings.all();
  const gateOn = s.attentionReadinessGate && s.attentionEnabled && s.weightAttention > 0;
  const positions = [...open, ...closed].sort((a, b) => b.entryAtMs - a.entryAtMs).slice(0, 60);
  const buys = positions.map((p) => ({ mint: p.mint, symbol: p.symbol, entryAtMs: p.entryAtMs }));
  const research = new Map<string, AuthorityResearch>();
  for (const b of buys) {
    const rec = svc.attentionRepo.get(b.mint);
    if (rec) research.set(b.mint, { at: rec.at, attention: rec.scores.attention, confidence: rec.scores.confidence });
  }
  const counters = metrics.snapshot().counters;
  const authority = auditAuthority({
    gateOn,
    buys,
    research,
    counters: {
      scoredBuys: (counters.scored_BUY_SMALL ?? 0) + (counters.scored_BUY_STRONG ?? 0),
      attentionGatedBuys: counters.attention_gated_buy ?? 0,
    },
  });

  return combineAthenaAudit(dataTruth, authority, now);
}
