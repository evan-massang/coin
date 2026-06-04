import { describe, it, expect } from "vitest";
import { runAgents, scoreOf } from "./coordinator.js";
import type { Agent, AgentContext } from "./types.js";

function ctx(): AgentContext {
  return {
    token: { mint: "M", seenAt: 0 },
    trades: [],
    now: 1000,
    firstSeenAt: 0,
    marketCapsSol: [],
    smartWallets: new Map(),
    hype: async () => ({ score: 50, isRevival: false, source: "heuristic", rationale: "", tags: [] }),
  };
}

const good: Agent = { id: "good", run: () => ({ score: 80, confidence: 0.9, reasons: ["ok"] }) };
const slow: Agent = {
  id: "slow",
  run: () => new Promise((resolve) => setTimeout(() => resolve({ score: 90, confidence: 1, reasons: [] }), 10_000)),
};
const thrower: Agent = {
  id: "boom",
  run: () => {
    throw new Error("kaboom");
  },
};

describe("runAgents coordinator", () => {
  it("collects good results", async () => {
    const map = await runAgents([good], ctx(), 500);
    expect(map.get("good")?.score).toBe(80);
    expect(map.get("good")?.unknown).toBeFalsy();
  });

  it("never throws and degrades a slow agent to unknown (timeout)", async () => {
    const map = await runAgents([good, slow], ctx(), 50);
    expect(map.get("good")?.score).toBe(80); // fast agent unaffected
    expect(map.get("slow")?.unknown).toBe(true);
    expect(map.get("slow")?.confidence).toBe(0);
  });

  it("never throws and degrades a throwing agent to unknown", async () => {
    const map = await runAgents([good, thrower], ctx(), 500);
    expect(map.get("boom")?.unknown).toBe(true);
    expect(map.get("good")?.score).toBe(80);
  });

  it("scoreOf returns the score when confident, else the neutral fallback", async () => {
    const map = await runAgents([good, thrower], ctx(), 500);
    expect(scoreOf(map, "good")).toBe(80);
    expect(scoreOf(map, "boom")).toBe(50); // unknown ⇒ fallback
    expect(scoreOf(map, "missing", 42)).toBe(42);
  });
});
