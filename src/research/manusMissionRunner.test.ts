import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openDb, type DB } from "../store/db.js";
import { MissionRepo } from "../store/repositories/missionRepo.js";
import { SettingsStore } from "../store/settingsStore.js";
import { ManusMissionRunner } from "./manusMissionRunner.js";
import type { Services } from "../services.js";
import type { Mission } from "./mission.types.js";

// Runner lifecycle against a real in-memory DB (migrations v13) + a mocked Manus
// API. Verifies: dispatch marks SENT with external refs; a stopped task with a
// structured result resolves + injects through the advisory path; an error task
// fails; a stale task times out; the auto-mission hourly cap holds.

function mission(over: Partial<Mission> = {}): Mission {
  return {
    mint: "MINT1", symbol: "DOGE", objective: "o", verdict: "WATCH_ONLY", conviction: 49,
    buckets: [], gaps: [], outputContract: "c", createdAt: 1_000, ...over,
  };
}

function fetchScript(responses: Array<{ status: number; body: unknown }>): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    return { ok: r.status < 300, status: r.status, text: async () => JSON.stringify(r.body) };
  }) as unknown as typeof fetch;
}

describe("ManusMissionRunner", () => {
  let db: DB;
  let missions: MissionRepo;
  let injected: Array<{ mint: string; source: string; attention: number }>;
  let svc: Services;
  let now: number;

  beforeEach(() => {
    db = openDb(":memory:");
    missions = new MissionRepo(db);
    injected = [];
    now = 1_000_000;
    const settings = new SettingsStore(db);
    settings.update({ manusApiKey: "TESTKEY" });
    svc = {
      settings,
      missions,
      attention: { injectResult: (rec: { mint: string; source: string; scores: { attention: number } }) => injected.push({ mint: rec.mint, source: rec.source, attention: rec.scores.attention }) },
    } as unknown as Services;
  });
  afterEach(() => db.close());

  const runner = (fetchFn: typeof fetch) => new ManusMissionRunner(svc, { fetchFn, now: () => now });

  it("available() is false without a key (board stays manual)", () => {
    (svc.settings as SettingsStore).update({ manusApiKey: "" });
    expect(runner(fetchScript([])).available()).toBe(false);
  });

  it("sendMission dispatches task.create and marks the mission SENT with external refs", async () => {
    const id = missions.insert(mission());
    const r = runner(fetchScript([{ status: 200, body: { ok: true, task_id: "T9", task_url: "https://manus.im/t/T9" } }]));
    const out = await r.sendMission(id, "operator");
    expect(out).toEqual({ ok: true, taskUrl: "https://manus.im/t/T9" });
    const row = missions.get(id)!;
    expect(row.status).toBe("sent");
    expect(row.externalId).toBe("T9");
    expect(row.externalUrl).toBe("https://manus.im/t/T9");
  });

  it("a failed dispatch leaves the mission OPEN (operator can paste manually)", async () => {
    const id = missions.insert(mission());
    const out = await runner(fetchScript([{ status: 401, body: { error: "bad key" } }])).sendMission(id, "operator");
    expect(out.ok).toBe(false);
    expect(missions.get(id)!.status).toBe("open");
  });

  it("pollOnce: stopped + structured result → resolved + injected through the advisory path (clamped)", async () => {
    const id = missions.insert(mission());
    const f = fetchScript([
      { status: 200, body: { ok: true, task_id: "T1", task_url: "u" } },
      { status: 200, body: { events: [
        { type: "structured_output_result", success: true, value: { recommendation: "confirm", confidence: 85, scores: { attention: 1e9, humanity: 90, virality: 70, outsideCrypto: 60, culturalStrength: 50 }, narrative: "spreading", reasons: ["found it"], bullCase: "bull", bearCase: "bear" } },
        { type: "status_update", agent_status: "stopped" },
      ] } },
    ]);
    const r = runner(f);
    await r.sendMission(id, "operator");
    await r.pollOnce();
    const row = missions.get(id)!;
    expect(row.status).toBe("resolved");
    expect(row.result?.recommendation).toBe("confirm");
    expect(row.result?.reasons?.some((x) => x.startsWith("bear:"))).toBe(true); // bear case preserved in audit trail
    expect(injected).toHaveLength(1);
    expect(injected[0].source).toBe("manus");
    expect(injected[0].attention).toBe(100); // 1e9 clamped before touching the engine
  });

  it("pollOnce: agent_status=error → mission FAILED with the error message", async () => {
    const id = missions.insert(mission());
    const f = fetchScript([
      { status: 200, body: { ok: true, task_id: "T2" } },
      { status: 200, body: { events: [{ type: "error_message", content: "credits exhausted" }, { type: "status_update", agent_status: "error" }] } },
    ]);
    const r = runner(f);
    await r.sendMission(id, "operator");
    await r.pollOnce();
    const row = missions.get(id)!;
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/credits exhausted/);
    expect(injected).toHaveLength(0); // nothing injected on failure
  });

  it("pollOnce: still running past the timeout → mission FAILED (timeout)", async () => {
    const id = missions.insert(mission());
    const f = fetchScript([
      { status: 200, body: { ok: true, task_id: "T3" } },
      { status: 200, body: { events: [{ type: "status_update", agent_status: "running" }] } },
    ]);
    const r = runner(f);
    await r.sendMission(id, "operator");
    now += 46 * 60_000; // past the 45-min default
    await r.pollOnce();
    expect(missions.get(id)!.status).toBe("failed");
    expect(missions.get(id)!.error).toMatch(/timed out/);
  });

  it("auto-missions respect the hourly cap; operator sends do not", async () => {
    (svc.settings as SettingsStore).update({ manusMaxPerHour: 1 });
    const ok = fetchScript([{ status: 200, body: { ok: true, task_id: "TA" } }]);
    const r = runner(ok);
    const id1 = missions.insert(mission({ mint: "M1" }));
    expect((await r.sendMission(id1, "auto")).ok).toBe(true);
    const id2 = missions.insert(mission({ mint: "M2" }));
    const blocked = await r.sendMission(id2, "auto");
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/cap/);
    const id3 = missions.insert(mission({ mint: "M3" }));
    expect((await r.sendMission(id3, "operator")).ok).toBe(true); // operator bypasses the cap
  });
});
