import { describe, it, expect } from "vitest";
import { auditAuthority, type AuthorityResearch } from "./authorityAudit.js";

const research = (entries: Array<[string, AuthorityResearch]>): Map<string, AuthorityResearch> => new Map(entries);

describe("auditAuthority (Phase 17/22 decision authority)", () => {
  it("reports per-buy which intelligence backed it + research-before-buy", () => {
    const r = auditAuthority({
      gateOn: true,
      buys: [
        { mint: "A", symbol: "AA", entryAtMs: 1000 },
        { mint: "B", symbol: "BB", entryAtMs: 2000 },
      ],
      research: research([
        ["A", { at: 900, attention: 70, confidence: 0.6 }], // research before the buy
        ["B", { at: 2500, attention: 50, confidence: 0.4 }], // refreshed AFTER the buy
      ]),
      counters: { scoredBuys: 0, attentionGatedBuys: 2 },
    });
    expect(r.researched).toBe(2);
    expect(r.pctResearched).toBe(1);
    expect(r.buys[0].researchBeforeBuy).toBe(true);
    expect(r.buys[1].researchBeforeBuy).toBe(false); // informational, not a violation
    expect(r.buys[0].attention).toBe(70);
  });

  it("THE invariant: gate ON with zero scored (pre-research) buys ⇒ no silent bypass", () => {
    const r = auditAuthority({
      gateOn: true,
      buys: [{ mint: "A", entryAtMs: 1 }],
      research: research([["A", { at: 0, attention: 60, confidence: 0.5 }]]),
      counters: { scoredBuys: 0, attentionGatedBuys: 1 },
    });
    expect(r.noSilentBypass).toBe(true);
  });

  it("DETECTS a silent bypass: gate ON but a buy executed via the pre-research path", () => {
    const r = auditAuthority({
      gateOn: true,
      buys: [{ mint: "A", entryAtMs: 1 }],
      research: research([]),
      counters: { scoredBuys: 3, attentionGatedBuys: 0 }, // 3 buys skipped attention!
    });
    expect(r.noSilentBypass).toBe(false);
    expect(r.unresearched).toBe(1);
  });

  it("gate OFF ⇒ bypass invariant is vacuously satisfied (legacy mode)", () => {
    const r = auditAuthority({
      gateOn: false,
      buys: [{ mint: "A", entryAtMs: 1 }],
      research: research([]),
      counters: { scoredBuys: 5, attentionGatedBuys: 0 },
    });
    expect(r.noSilentBypass).toBe(true);
  });
});
