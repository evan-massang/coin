import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type DB } from "../db.js";
import { MissionRepo } from "./missionRepo.js";
import type { Mission } from "../../research/mission.types.js";

function mission(over: Partial<Mission> = {}): Mission {
  return {
    mint: "M1", symbol: "DOGE", objective: "o", verdict: "WATCH_ONLY", conviction: 49,
    buckets: [], gaps: [], outputContract: "c", createdAt: 1_000, ...over,
  };
}

describe("MissionRepo lifecycle (v13: sent/failed + re-resolution guard)", () => {
  let db: DB;
  let repo: MissionRepo;
  beforeEach(() => {
    db = openDb(":memory:");
    repo = new MissionRepo(db);
  });
  afterEach(() => db.close());

  it("open → sent → resolved, with external refs round-tripping", () => {
    const id = repo.insert(mission());
    expect(repo.setSent(id, "T1", "https://manus.im/t/T1", 2_000)).toBe(true);
    const sent = repo.get(id)!;
    expect(sent.status).toBe("sent");
    expect(sent.externalId).toBe("T1");
    expect(sent.sentAt).toBe(2_000);
    expect(repo.sentMissions().map((m) => m.id)).toEqual([id]);
    expect(repo.setResult(id, { recommendation: "confirm", confidence: 80, provider: "manus" }, 3_000)).toBe(true);
    expect(repo.get(id)!.status).toBe("resolved");
    expect(repo.sentMissions()).toHaveLength(0);
  });

  it("a RESOLVED mission can NOT be re-resolved (red-team fix: no unlimited re-injection)", () => {
    const id = repo.insert(mission());
    expect(repo.setResult(id, { recommendation: "confirm", confidence: 80 }, 2_000)).toBe(true);
    expect(repo.setResult(id, { recommendation: "avoid", confidence: 99 }, 3_000)).toBe(false);
    expect(repo.get(id)!.result?.recommendation).toBe("confirm"); // first result stands
  });

  it("setSent only fires from OPEN (no re-dispatch of a resolved/failed mission)", () => {
    const id = repo.insert(mission());
    repo.setResult(id, { recommendation: "confirm", confidence: 80 }, 2_000);
    expect(repo.setSent(id, "T2", undefined, 3_000)).toBe(false);
  });

  it("markFailed stores the reason and removes it from the poll set", () => {
    const id = repo.insert(mission());
    repo.setSent(id, "T1", undefined, 2_000);
    expect(repo.markFailed(id, "timed out after 45min", 3_000)).toBe(true);
    const row = repo.get(id)!;
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/timed out/);
    expect(repo.sentMissions()).toHaveLength(0);
  });

  it("countSentSince counts only dispatches inside the window (hourly cap input)", () => {
    const a = repo.insert(mission({ mint: "A" }));
    const b = repo.insert(mission({ mint: "B" }));
    repo.setSent(a, "TA", undefined, 1_000);
    repo.setSent(b, "TB", undefined, 5_000);
    expect(repo.countSentSince(2_000)).toBe(1);
    expect(repo.countSentSince(0)).toBe(2);
  });
});
