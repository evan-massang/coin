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

  it("forMint returns a coin's decision EVOLUTION oldest→newest (the WATCH→BUY journey)", () => {
    repo.insert(decision({ mint: "EVO", verdict: "WATCH_ONLY", conviction: 59, at: 100, flags: ["awaiting-attention"] }));
    repo.insert(decision({ mint: "EVO", verdict: "BUY_SMALL", conviction: 59, at: 200 }));
    repo.insert(decision({ mint: "OTHER", verdict: "AVOID", at: 150 }));
    const tl = repo.forMint("EVO");
    expect(tl.map((s) => s.verdict)).toEqual(["WATCH_ONLY", "BUY_SMALL"]); // oldest→newest, only EVO
    expect(tl[0].flags).toContain("awaiting-attention");
  });

  it("round-trips pairCreatedAt (true coin age) — persisted and read back; undefined when absent", () => {
    const born = 1_700_000_000_000;
    repo.insert(decision({ mint: "AGED", verdict: "WATCH_ONLY", pairCreatedAt: born }));
    repo.insert(decision({ mint: "NEWBORN", verdict: "WATCH_ONLY" })); // no DEX pair ⇒ undefined
    const rows = repo.recent(10);
    expect(rows.find((r) => r.mint === "AGED")?.pairCreatedAt).toBe(born);
    expect(rows.find((r) => r.mint === "NEWBORN")?.pairCreatedAt).toBeUndefined();
  });
});

describe("SignalsRepo.recentForTracking", () => {
  let db: DB;
  let repo: SignalsRepo;
  beforeEach(() => {
    db = openDb(":memory:");
    repo = new SignalsRepo(db);
  });
  afterEach(() => db.close());

  it("returns BUY/WATCH within the time window, excludes AVOID and stale rows", () => {
    const now = 10_000_000;
    repo.insert(decision({ mint: "BUY_RECENT", verdict: "BUY_SMALL", at: now - 10 * 60_000 }));
    repo.insert(decision({ mint: "WATCH_RECENT", verdict: "WATCH_ONLY", at: now - 30 * 60_000 }));
    repo.insert(decision({ mint: "AVOID_RECENT", verdict: "AVOID", at: now - 60_000 })); // wrong verdict
    repo.insert(decision({ mint: "BUY_STALE", verdict: "BUY_STRONG", at: now - 2 * 60 * 60_000 })); // outside window

    const got = repo.recentForTracking(60 * 60_000, now).map((s) => s.mint);
    expect(got).toContain("BUY_RECENT");
    expect(got).toContain("WATCH_RECENT");
    expect(got).not.toContain("AVOID_RECENT");
    expect(got).not.toContain("BUY_STALE");
    // newest-first
    expect(got[0]).toBe("BUY_RECENT");
  });
});
