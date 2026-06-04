import { describe, it, expect } from "vitest";
import { fingerprintToken, isSimilarToRug, normalizeName } from "./tokenSimilarity.js";
import { deployerReputation } from "./deployerGraph.js";
import { clusterRisk } from "./walletClusterGraph.js";

describe("fingerprintToken", () => {
  it("is stable for the same input", () => {
    const a = fingerprintToken({ name: "Doge Killer", symbol: "DOGEK", uri: "https://x.io/m.json" });
    const b = fingerprintToken({ name: "Doge Killer", symbol: "DOGEK", uri: "https://x.io/m.json" });
    expect(a.hash).toBe(b.hash);
  });

  it("normalizes names (case/punctuation insensitive)", () => {
    expect(normalizeName("Doge!! Killer ")).toBe("dogekiller");
    expect(fingerprintToken({ name: "DOGE killer" }).normName).toBe("dogekiller");
  });

  it("differs when the name differs", () => {
    const a = fingerprintToken({ name: "Pepe", symbol: "PEPE" });
    const b = fingerprintToken({ name: "Wif", symbol: "WIF" });
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("isSimilarToRug", () => {
  it("flags a new token that echoes a known rug (slashes the multiplier)", () => {
    const rug = fingerprintToken({ name: "Scam Inu", symbol: "SCAM", uri: "https://bad.io/m.json" });
    const r = isSimilarToRug({ name: "Scam Inu", symbol: "SCAM", uri: "https://bad.io/m.json" }, [rug]);
    expect(r.similar).toBe(true);
    expect(r.multiplier).toBeLessThanOrEqual(0.25);
  });

  it("matches on shared normalized name even if links differ", () => {
    const rug = fingerprintToken({ name: "Scam Inu", symbol: "SCAM", uri: "https://old.io/a.json" });
    const r = isSimilarToRug({ name: "scam inu", symbol: "SCAM2", uri: "https://new.io/b.json" }, [rug]);
    expect(r.similar).toBe(true);
  });

  it("does not flag an unrelated token", () => {
    const rug = fingerprintToken({ name: "Scam Inu", symbol: "SCAM" });
    expect(isSimilarToRug({ name: "Honest Cat", symbol: "HCAT" }, [rug]).similar).toBe(false);
  });
});

describe("deployerReputation", () => {
  it("heavily cuts a repeat rugger", () => {
    expect(deployerReputation({ creator: "x", launches: 6, rugs: 4, winners: 0, firstSeen: 0, lastSeen: 0 }).multiplier).toBeLessThanOrEqual(0.25);
  });
  it("gives a clean serial deployer a small bonus", () => {
    expect(deployerReputation({ creator: "x", launches: 5, rugs: 0, winners: 2, firstSeen: 0, lastSeen: 0 }).multiplier).toBeGreaterThan(1);
  });
  it("is neutral for an unknown/new deployer", () => {
    expect(deployerReputation(undefined).multiplier).toBe(1);
  });
});

describe("clusterRisk", () => {
  it("cuts size as rug overlap rises", () => {
    expect(clusterRisk(0).multiplier).toBe(1);
    expect(clusterRisk(2).multiplier).toBeLessThan(1);
    expect(clusterRisk(5).multiplier).toBeLessThan(clusterRisk(2).multiplier);
  });
});
