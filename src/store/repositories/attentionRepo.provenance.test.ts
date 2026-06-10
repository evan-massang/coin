import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type DB } from "../db.js";
import { AttentionRepo } from "./attentionRepo.js";
import type { AttentionRecord } from "../../attention/attentionService.js";

function rec(source: string, attention: number, at: number): AttentionRecord {
  return {
    mint: "M1",
    at,
    source,
    scores: { humanity: 50, virality: 50, outsideCrypto: 50, culturalStrength: 50, attention, confidence: 0.7, tags: [], narrative: `n-${source}`, reasons: [] },
    evidence: { mint: "M1", symbol: "DOGE", query: "DOGE", posts: [], platforms: [], links: [], fetchedAt: at },
  };
}

describe("AttentionRepo provenance + history (V5.1 audit fixes)", () => {
  let db: DB;
  let repo: AttentionRepo;
  beforeEach(() => {
    db = openDb(":memory:");
    repo = new AttentionRepo(db);
  });
  afterEach(() => db.close());

  it("round-trips provider provenance verbatim — a Manus read no longer reloads as 'heuristic'", () => {
    repo.upsert(rec("manus", 78, 1_000));
    expect(repo.get("M1")?.source).toBe("manus");
    expect(repo.recent(10)[0]?.source).toBe("manus"); // the warm path the engine boots from
  });

  it("history is append-only — a later Athena pass no longer DESTROYS the Manus read", () => {
    repo.upsert(rec("manus", 78, 1_000));
    repo.upsert(rec("heuristic", 60, 2_000)); // overwrites the snapshot…
    expect(repo.get("M1")?.source).toBe("heuristic"); // …latest snapshot is Athena
    const hist = repo.history("M1");
    expect(hist.map((h) => h.source)).toEqual(["manus", "heuristic"]); // …but history kept BOTH
    expect(hist[0].attention).toBe(78);
    expect(hist[1].attention).toBe(60);
  });
});
