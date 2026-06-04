import { describe, it, expect } from "vitest";
import { parseRugcheckReport } from "./rugcheck.js";

// BONK-like healthy token: authorities null, a >80% curve holder + insiders +
// real holders, warn-only risks, locked LP across markets.
function bonkLike() {
  return {
    mintAuthority: null,
    freezeAuthority: null,
    token: { mintAuthority: null, freezeAuthority: null },
    topHolders: [
      { pct: 92, insider: false }, // bonding curve / LP → excluded (>80)
      { pct: 40, insider: true }, // insider → excluded
      { pct: 7.95, insider: false }, // largest real holder
      { pct: 3.2, insider: false },
    ],
    risks: [{ name: "Low liquidity", level: "warn", description: "…" }],
    score_normalised: 7,
    markets: [
      { lp: { lpLockedPct: 100, quoteUSD: 500_000, baseUSD: 500_000 } },
      { lp: { lpLockedPct: 95, quoteUSD: 100_000, baseUSD: 100_000 } },
    ],
  };
}

describe("parseRugcheckReport", () => {
  it("parses a clean BONK-like token correctly", () => {
    const r = parseRugcheckReport(bonkLike());
    expect(r.mintAuthorityRevoked).toBe(true);
    expect(r.freezeAuthorityNull).toBe(true);
    expect(r.topHolderPct).toBeCloseTo(7.95, 2); // excludes the 92% curve + 40% insider
    expect(r.riskLevel).toBe("medium"); // warn-only
    expect(r.honeypot).toBe(false);
    expect(r.highRisk).toBe(false);
    expect(r.insiderClean).toBe(true);
    expect(r.lpLockedPct).toBe(100);
    expect(r.totalLiquidityUsd).toBeCloseTo(1_200_000, 0);
    expect(r.scoreNormalised).toBe(7);
  });

  it("flags a honeypot via a danger-level cannot-sell risk", () => {
    const r = parseRugcheckReport({
      token: { mintAuthority: null, freezeAuthority: null },
      risks: [{ name: "Honeypot", level: "danger", description: "cannot sell this token" }],
    });
    expect(r.honeypot).toBe(true);
    expect(r.highRisk).toBe(true);
    expect(r.riskLevel).toBe("danger");
  });

  it("flags a honeypot via a high transfer fee", () => {
    expect(parseRugcheckReport({ token: { mintAuthority: null }, transferFee: { pct: 100 } }).honeypot).toBe(true);
  });

  it("treats rugged=true as a honeypot", () => {
    expect(parseRugcheckReport({ rugged: true, token: { mintAuthority: null } }).honeypot).toBe(true);
  });

  it("warn-only risks are medium, NOT high risk (lenient)", () => {
    const r = parseRugcheckReport({ token: { mintAuthority: null }, risks: [{ name: "x", level: "warn" }] });
    expect(r.riskLevel).toBe("medium");
    expect(r.highRisk).toBe(false);
  });

  it("a large insider count with NO danger insider risk stays insiderClean (ignores noisy count)", () => {
    const r = parseRugcheckReport({
      token: { mintAuthority: null },
      topHolders: [{ pct: 50, insider: true }, { pct: 6, insider: false }],
      risks: [{ name: "Some warning", level: "warn" }],
    });
    expect(r.insiderClean).toBe(true);
    expect(r.topHolderPct).toBe(6); // insider excluded
  });

  it("a DANGER-level bundle/insider risk flips insiderClean false", () => {
    const r = parseRugcheckReport({
      token: { mintAuthority: null },
      risks: [{ name: "Bundled supply", level: "danger", description: "insider bundle detected" }],
    });
    expect(r.insiderClean).toBe(false);
  });

  it("detects a live mint authority as not revoked", () => {
    const r = parseRugcheckReport({ mintAuthority: "SomeAuthorityPubkey", token: { mintAuthority: "SomeAuthorityPubkey" } });
    expect(r.mintAuthorityRevoked).toBe(false);
  });

  it("missing body → unknown risk level, undefined fields, no throw", () => {
    const r = parseRugcheckReport({});
    expect(r.riskLevel).toBe("unknown");
    expect(r.mintAuthorityRevoked).toBeUndefined();
    expect(r.topHolderPct).toBeUndefined();
    expect(r.honeypot).toBe(false);
    expect(r.lpLockedPct).toBeUndefined();
  });
});
