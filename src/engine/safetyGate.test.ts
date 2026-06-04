import { describe, it, expect } from "vitest";
import { evaluateStage0, evaluateStage1, type Stage0Inputs, type SafetyConfig } from "./safetyGate.js";

const CFG: SafetyConfig = { maxTopHolderPct: 25 };

function clean(): Stage0Inputs {
  return {
    metadata: { name: "DogWifHat", symbol: "WIF", uri: "https://x/y.json" },
    mintAuthorityRevoked: true,
    freezeAuthorityNull: true,
    deployerBlacklisted: false,
    topHolderPct: 8,
    bundleDetected: false,
    rugcheck: { riskLevel: "low", highRisk: false },
  };
}

describe("Stage-0 hard kills", () => {
  it("passes a clean token", () => {
    const r = evaluateStage0(clean(), CFG);
    expect(r.pass).toBe(true);
    expect(r.stage).toBe(0);
    expect(r.unknownCount).toBe(0);
  });

  it("fails when mint authority is not revoked", () => {
    const r = evaluateStage0({ ...clean(), mintAuthorityRevoked: false }, CFG);
    expect(r.pass).toBe(false);
    expect(r.fatalReasons.join(" ")).toMatch(/mint authority/i);
  });

  it("fails when freeze authority is present", () => {
    const r = evaluateStage0({ ...clean(), freezeAuthorityNull: false }, CFG);
    expect(r.pass).toBe(false);
    expect(r.fatalReasons.join(" ")).toMatch(/freeze/i);
  });

  it("fails a blacklisted deployer", () => {
    expect(evaluateStage0({ ...clean(), deployerBlacklisted: true }, CFG).pass).toBe(false);
  });

  it("fails empty metadata (no name or symbol)", () => {
    const r = evaluateStage0({ ...clean(), metadata: {} }, CFG);
    expect(r.pass).toBe(false);
    expect(r.fatalReasons.join(" ")).toMatch(/name or symbol/i);
  });

  it("fails early holder concentration over the cap", () => {
    const r = evaluateStage0({ ...clean(), topHolderPct: 40 }, CFG);
    expect(r.pass).toBe(false);
    expect(r.fatalReasons.join(" ")).toMatch(/top holder/i);
  });

  it("fails an obvious bundle/sniper cluster", () => {
    expect(evaluateStage0({ ...clean(), bundleDetected: true }, CFG).pass).toBe(false);
  });

  it("UNKNOWN values do not fail the gate but raise unknownCount", () => {
    const r = evaluateStage0(
      { ...clean(), mintAuthorityRevoked: undefined, topHolderPct: undefined, bundleDetected: undefined },
      CFG,
    );
    expect(r.pass).toBe(true);
    expect(r.unknownCount).toBeGreaterThanOrEqual(2);
  });
});

describe("Stage-1 promotion (survivors only)", () => {
  it("promotes a clean survivor to stage 1, pass=true", () => {
    const s0 = evaluateStage0(clean(), CFG);
    const s1 = evaluateStage1(s0, { devWalletSold: false, topHolderDistributing: false, freshWalletRatio: 0.4, bundleScore: 20 });
    expect(s1.stage).toBe(1);
    expect(s1.pass).toBe(true);
  });

  it("hard-fails if the dev wallet sold during observation", () => {
    const s0 = evaluateStage0(clean(), CFG);
    const s1 = evaluateStage1(s0, { devWalletSold: true });
    expect(s1.pass).toBe(false);
    expect(s1.fatalReasons.join(" ")).toMatch(/dev wallet/i);
  });

  it("hard-fails on extreme fresh-wallet ratio", () => {
    const s0 = evaluateStage0(clean(), CFG);
    const s1 = evaluateStage1(s0, { freshWalletRatio: 0.95 });
    expect(s1.pass).toBe(false);
  });

  it("is a no-op pass-through when Stage-0 already failed", () => {
    const s0 = evaluateStage0({ ...clean(), mintAuthorityRevoked: false }, CFG);
    const s1 = evaluateStage1(s0, { devWalletSold: false });
    expect(s1.pass).toBe(false);
    expect(s1.stage).toBe(1);
  });
});

describe("Stage-0 with RugCheck inputs (the false safety-unknowns bug fix)", () => {
  it("RugCheck data resolves the unknowns that caused the false WATCH_ONLY cap", () => {
    // Without RugCheck and without holder/bundle data: ≥2 UNKNOWN → the old cap.
    const withoutRc = evaluateStage0(
      { ...clean(), topHolderPct: undefined, bundleDetected: undefined, rugcheck: undefined },
      CFG,
    );
    expect(withoutRc.unknownCount).toBeGreaterThanOrEqual(2);

    // With RugCheck resolving holders + bundle + risk: no unknowns, passes clean.
    const withRc = evaluateStage0(
      { ...clean(), topHolderPct: 8, bundleDetected: false, rugcheck: { riskLevel: "low", highRisk: false } },
      CFG,
    );
    expect(withRc.unknownCount).toBe(0);
    expect(withRc.pass).toBe(true);
  });

  it("RugCheck honeypot is a hard fail", () => {
    const r = evaluateStage0({ ...clean(), rugcheck: { riskLevel: "danger", highRisk: true, honeypot: true } }, CFG);
    expect(r.pass).toBe(false);
    expect(r.fatalReasons.join(" ")).toMatch(/honeypot/i);
  });

  it("a non-honeypot danger/medium risk does NOT hard-fail (lenient)", () => {
    const medium = evaluateStage0({ ...clean(), rugcheck: { riskLevel: "medium", highRisk: false } }, CFG);
    expect(medium.pass).toBe(true);
    const dangerNoHoneypot = evaluateStage0({ ...clean(), rugcheck: { riskLevel: "danger", highRisk: false, honeypot: false } }, CFG);
    expect(dangerNoHoneypot.pass).toBe(true);
  });

  it("thin liquidity is non-fatal (never blocks a brand-new token)", () => {
    const r = evaluateStage0(
      { ...clean(), lp: { liquidityUsd: 100, lpLockedPct: 0 } },
      { ...CFG, minLiquidityUsd: 3000 },
    );
    expect(r.pass).toBe(true);
    expect(r.checks.find((c) => c.id === "liquidity")?.status).toBe("FAIL");
    expect(r.checks.find((c) => c.id === "liquidity")?.fatal).toBe(false);
  });

  it("missing RugCheck behaves like before (rugcheckRisk UNKNOWN, non-fatal)", () => {
    const r = evaluateStage0({ ...clean(), rugcheck: undefined }, CFG);
    expect(r.pass).toBe(true);
    expect(r.checks.find((c) => c.id === "rugcheckRisk")?.status).toBe("UNKNOWN");
  });
});
