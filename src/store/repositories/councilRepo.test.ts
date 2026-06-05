import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type DB } from "../db.js";
import { CouncilRepo, type CouncilOpinionInput } from "./councilRepo.js";

function op(over: Partial<CouncilOpinionInput> = {}): CouncilOpinionInput {
  return { at: 1, mint: "M1", symbol: "X", memberId: "claude", label: "Claude", role: "bull_analyst", model: "", score: 70, recommendation: "confirm", rationale: "r", ...over };
}

describe("CouncilRepo", () => {
  let db: DB;
  let repo: CouncilRepo;
  beforeEach(() => { db = openDb(":memory:"); repo = new CouncilRepo(db); });
  afterEach(() => db.close());

  it("records opinions and lists them newest-first", () => {
    repo.record(op({ at: 1 }));
    repo.record(op({ at: 2, memberId: "deepseek", label: "DeepSeek" }));
    const rows = repo.recent();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.at).toBe(2);
  });

  it("resolve() scores accuracy + false negatives per seat", () => {
    repo.record(op({ memberId: "claude", recommendation: "confirm" })); // win ⇒ correct
    repo.record(op({ memberId: "deepseek", recommendation: "caution" })); // win ⇒ false negative
    repo.resolve("M1", "win", 150);
    const stats = repo.memberStats();
    const claude = stats.find((s) => s.memberId === "claude")!;
    const ds = stats.find((s) => s.memberId === "deepseek")!;
    expect(claude.resolved).toBe(1);
    expect(claude.accuracy).toBe(1);
    expect(claude.falseNegatives).toBe(0);
    expect(ds.accuracy).toBe(0);
    expect(ds.falseNegatives).toBe(1);
  });

  it("a confirm that loses is a false positive", () => {
    repo.record(op({ memberId: "claude", recommendation: "confirm" }));
    repo.resolve("M1", "loss", 5);
    const claude = repo.memberStats().find((s) => s.memberId === "claude")!;
    expect(claude.falsePositives).toBe(1);
    expect(claude.accuracy).toBe(0);
  });

  it("weights stay equal (1) until enough resolved samples", () => {
    for (let i = 0; i < 3; i++) repo.record(op({ mint: "T" + i }));
    repo.resolve("T0", "win", 150);
    expect(repo.weights().claude).toBe(1); // <8 resolved ⇒ neutral weight
  });
});
