import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type DB } from "../db.js";
import { CouncilRepo } from "./councilRepo.js";

// Operator-teardown sanity alarm: any seat that hasn't varied its verdict in
// 100+ calls is broken by definition (qwen: CONFIRM 1104/1128; llama: score=50
// in 1116/1126). memberStats now flags such seats `collapsed`.

describe("CouncilRepo.memberStats — collapse alarm", () => {
  let db: DB;
  let repo: CouncilRepo;
  beforeEach(() => {
    db = openDb(":memory:");
    repo = new CouncilRepo(db);
  });
  afterEach(() => db.close());

  const opinion = (memberId: string, rec: "confirm" | "caution" | "reject", score: number, i: number) =>
    repo.record({ at: i, mint: `M${i}`, memberId, label: memberId, role: "bull_analyst", score, recommendation: rec, rationale: "r" });

  it("flags a yes-machine (one verdict >95% over 100+ calls)", () => {
    for (let i = 0; i < 118; i++) opinion("yesbot", "confirm", 60 + (i % 20), i); // varied scores, constant verdict
    for (let i = 0; i < 2; i++) opinion("yesbot", "caution", 50, 200 + i);
    const s = repo.memberStats().find((x) => x.memberId === "yesbot")!;
    expect(s.collapsed).toBe(true);
  });

  it("flags a constant scorer (>90% one exact score) even with varied verdicts", () => {
    // llama pattern: nominally varied scores, but 99% land on exactly 50.
    for (let i = 0; i < 112; i++) opinion("const50", i % 2 ? "caution" : "confirm", 50, i);
    for (let i = 0; i < 8; i++) opinion("const50", "caution", 40 + i, 300 + i);
    const s = repo.memberStats().find((x) => x.memberId === "const50")!;
    expect(s.collapsed).toBe(true);
  });

  it("does NOT flag a varied analyst or a small sample", () => {
    for (let i = 0; i < 120; i++) opinion("varied", (["confirm", "caution", "reject"] as const)[i % 3], 20 + (i % 60), i);
    for (let i = 0; i < 20; i++) opinion("young", "confirm", 70, i); // constant but n<100
    const stats = repo.memberStats();
    expect(stats.find((x) => x.memberId === "varied")!.collapsed).toBe(false);
    expect(stats.find((x) => x.memberId === "young")!.collapsed).toBe(false);
  });
});
