import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type DB } from "../store/db.js";
import { PaperRepo } from "../store/repositories/paperRepo.js";
import { velocityShadowGain, VELOCITY_SHADOW_VARIANTS, VELOCITY_WINDOW_MS } from "./exitEngine.js";

// SHADOW velocityExit (operator experiment): pure trigger math + the durable
// would-be-sell journal. Instrumentation only — verdicts never change (the
// exit tick wraps every shadow write in try/catch and sells nothing).

describe("velocityShadowGain (pure)", () => {
  it("not in profit ⇒ never judges", () => {
    expect(velocityShadowGain(-3, -20, false)).toBeUndefined();
    expect(velocityShadowGain(0, -20, true)).toBeUndefined();
  });
  it("gain = current − earliest-in-window sample", () => {
    expect(velocityShadowGain(14, 2, false)).toBe(12);
    expect(velocityShadowGain(9, 5, false)).toBe(4);
  });
  it("entry inside the window counts as a 0pp baseline (first-tick spike)", () => {
    expect(velocityShadowGain(12, undefined, true)).toBe(12);
    expect(velocityShadowGain(12, 6, true)).toBe(12); // entry(0) is the lower base
  });
  it("no baseline at all ⇒ cannot judge", () => {
    expect(velocityShadowGain(12, undefined, false)).toBeUndefined();
  });
  it("variants are the operator's sweep {8, 12, 15} on a 90s window", () => {
    expect([...VELOCITY_SHADOW_VARIANTS]).toEqual([8, 12, 15]);
    expect(VELOCITY_WINDOW_MS).toBe(90_000);
  });
});

describe("paper repo — shadow journal + window base", () => {
  let db: DB;
  let paper: PaperRepo;
  beforeEach(() => {
    db = openDb(":memory:");
    paper = new PaperRepo(db);
  });
  afterEach(() => db.close());

  it("earliestPnlSince returns the OLDEST sample inside the window", () => {
    paper.recordPriceSample(7, 1_000, 1);
    paper.recordPriceSample(7, 50_000, 3);
    paper.recordPriceSample(7, 80_000, 9);
    expect(paper.earliestPnlSince(7, 40_000)).toBe(3);
    expect(paper.earliestPnlSince(7, 0)).toBe(1);
    expect(paper.earliestPnlSince(7, 90_000)).toBeUndefined();
  });

  it("one row per (position, variant); re-fires are ignored", () => {
    const row = (variant: number, at: number) => ({
      positionId: 11, variantPct: variant, mint: "M", symbol: "X", entryAt: 0,
      triggeredAt: at, triggerPriceUsd: 0.001, pnlPctAtTrigger: 14, gainWindowPp: 13, windowMs: 90_000,
    });
    expect(paper.recordVelocityShadow(row(8, 100))).toBe(true);
    expect(paper.recordVelocityShadow(row(8, 200))).toBe(false); // dup variant
    expect(paper.recordVelocityShadow(row(12, 100))).toBe(true); // other variant ok
    const n = (db.prepare("SELECT COUNT(*) n FROM shadow_velocity_exits").get() as { n: number }).n;
    expect(n).toBe(2);
  });

  it("14-day retention: pruneSamples keeps two-week-old ticks", () => {
    const now = Date.now();
    paper.recordPriceSample(5, now - 13 * 24 * 3600_000, -4);
    paper.recordPriceSample(5, now - 6.5 * 3600_000, -2); // would have died at 6h
    paper.pruneSamples(now - 14 * 24 * 3600_000);
    const n = (db.prepare("SELECT COUNT(*) n FROM paper_price_samples").get() as { n: number }).n;
    expect(n).toBe(2);
  });
});
