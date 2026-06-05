import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type DB } from "../db.js";
import { SignalsRepo } from "./signalsRepo.js";
import { emptyScores, type Decision, type Verdict } from "../../types.js";

function decision(over: Partial<Decision> = {}): Decision {
  return {
    mint: "M1",
    symbol: "X",
    verdict: "WATCH_ONLY" as Verdict,
    conviction: 30,
    scores: emptyScores(),
    reasons: [],
    flags: [],
    caps: [],
    at: 1,
    ...over,
  };
}

describe("SignalsRepo.buyStats", () => {
  let db: DB;
  let repo: SignalsRepo;
  beforeEach(() => {
    db = openDb(":memory:");
    repo = new SignalsRepo(db);
  });
  afterEach(() => db.close());

  it("counts ONLY resolved BUYs — never-traded WATCH/AVOID tokens cannot poison the rate", () => {
    // 50 WATCH/AVOID tokens that resolved to a loss (these used to dominate
    // stats().winRate and force a false RISK_OFF). None were ever traded.
    for (let i = 0; i < 50; i++) {
      const id = repo.insert(decision({ mint: `W${i}`, verdict: i % 2 ? "WATCH_ONLY" : "AVOID" }));
      repo.updatePricePath(id, { maxGainPct: -40 }); // resolved, big loss
    }
    // 4 real BUYs: 1 winner (≥2x), 3 losers.
    const b1 = repo.insert(decision({ mint: "B1", verdict: "BUY_SMALL" }));
    repo.updatePricePath(b1, { maxGainPct: 150 }); // win
    for (let i = 0; i < 3; i++) {
      const id = repo.insert(decision({ mint: `B${i + 2}`, verdict: "BUY_SMALL" }));
      repo.updatePricePath(id, { maxGainPct: 10 }); // resolved, not a 2x
    }

    const all = repo.stats();
    const buys = repo.buyStats();

    // The all-signal win rate is crushed by the 50 never-traded losers…
    expect(all.winRate).toBeLessThan(0.05);
    // …but buyStats sees only the 4 real trades: 1/4 = 0.25.
    expect(buys.samples).toBe(4);
    expect(buys.winRate).toBeCloseTo(0.25, 5);
  });

  it("returns zero samples (not NaN) when nothing has been traded yet", () => {
    const id = repo.insert(decision({ verdict: "WATCH_ONLY" }));
    repo.updatePricePath(id, { maxGainPct: 20 });
    const buys = repo.buyStats();
    expect(buys.samples).toBe(0);
    expect(buys.winRate).toBe(0);
    expect(buys.avgMaxGainPct).toBe(0);
  });

  it("ignores BUYs that have not resolved yet (no forward path)", () => {
    repo.insert(decision({ mint: "OPEN", verdict: "BUY_STRONG" })); // no updatePricePath
    expect(repo.buyStats().samples).toBe(0);
  });
});
