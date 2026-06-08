import { describe, it, expect } from "vitest";
import { combineAthenaAudit } from "./athenaAudit.js";
import type { DataTruthReport } from "./dataTruthValidator.js";
import type { AuthorityReport } from "./authorityAudit.js";

const dt = (over: Partial<DataTruthReport> = {}): DataTruthReport => ({
  ok: true,
  checks: [{ name: "equity = cash + openValue", status: "PASS", detail: "ok" }],
  ...over,
});

const auth = (over: Partial<AuthorityReport> = {}): AuthorityReport => ({
  gateOn: true,
  total: 5,
  researched: 5,
  unresearched: 0,
  pctResearched: 1,
  noSilentBypass: true,
  counters: { scoredBuys: 0, attentionGatedBuys: 5 },
  buys: [],
  ...over,
});

describe("combineAthenaAudit (Phase 15 roll-up)", () => {
  it("PASS when both sub-reports are clean", () => {
    const r = combineAthenaAudit(dt(), auth(), 1);
    expect(r.status).toBe("PASS");
    expect(r.failures).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it("WARN bubbles up a data-truth WARN without failing", () => {
    const r = combineAthenaAudit(
      dt({ checks: [{ name: "per-fill ledger vs cash-derived realized", status: "WARN", detail: "Δ 0.69 SOL" }] }),
      auth(),
      1,
    );
    expect(r.status).toBe("WARN");
    expect(r.warnings[0]).toContain("ledger");
  });

  it("FAIL on a broken accounting identity", () => {
    const r = combineAthenaAudit(
      dt({ ok: false, checks: [{ name: "equity = cash + openValue", status: "FAIL", detail: "mismatch" }] }),
      auth(),
      1,
    );
    expect(r.status).toBe("FAIL");
    expect(r.failures[0]).toContain("equity");
  });

  it("FAIL on a silent gate bypass (authority)", () => {
    const r = combineAthenaAudit(dt(), auth({ noSilentBypass: false, counters: { scoredBuys: 4, attentionGatedBuys: 0 } }), 1);
    expect(r.status).toBe("FAIL");
    expect(r.failures.some((f) => f.includes("bypass"))).toBe(true);
  });
});
