import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type DB } from "../db.js";
import { MissionRepo } from "./missionRepo.js";
import type { Mission } from "../../research/mission.types.js";

function mission(over: Partial<Mission> = {}): Mission {
  return {
    mint: "MINT1",
    symbol: "DOGE",
    objective: "decide if attention grows",
    verdict: "WATCH_ONLY",
    conviction: 50,
    buckets: [{ key: "attention", known: ["not researched"], coverage: 0, thin: true }],
    gaps: ["attention"],
    outputContract: "strict json",
    createdAt: 1_000,
    ...over,
  };
}

describe("MissionRepo", () => {
  let db: DB;
  let repo: MissionRepo;
  beforeEach(() => {
    db = openDb(":memory:");
    repo = new MissionRepo(db);
  });
  afterEach(() => db.close());

  it("inserts an OPEN mission and reads it back with parsed JSON", () => {
    const id = repo.insert(mission());
    const row = repo.get(id)!;
    expect(row.status).toBe("open");
    expect(row.mint).toBe("MINT1");
    expect(row.mission.gaps).toEqual(["attention"]);
    expect(row.result).toBeUndefined();
  });

  it("setResult marks it resolved, stores the recommendation + provider", () => {
    const id = repo.insert(mission());
    repo.setResult(id, { recommendation: "confirm", confidence: 80, narrative: "spreading on tiktok", provider: "manus" }, 2_000);
    const row = repo.get(id)!;
    expect(row.status).toBe("resolved");
    expect(row.result?.recommendation).toBe("confirm");
    expect(row.provider).toBe("manus");
    expect(row.resolvedAt).toBe(2_000);
  });

  it("open() returns only open missions, newest first", () => {
    const a = repo.insert(mission({ mint: "A", createdAt: 100 }));
    repo.insert(mission({ mint: "B", createdAt: 200 }));
    repo.setResult(a, { recommendation: "avoid", confidence: 20 }, 300);
    const open = repo.open();
    expect(open.map((m) => m.mint)).toEqual(["B"]); // A resolved, excluded
  });

  it("cancel only affects an open mission", () => {
    const id = repo.insert(mission());
    repo.cancel(id);
    expect(repo.get(id)!.status).toBe("cancelled");
  });
});
