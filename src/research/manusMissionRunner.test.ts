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
  let injectedTokens: Array<{ mint: string; symbol?: string; discoverySource?: string }>;
  let svc: Services;
  let now: number;

  beforeEach(() => {
    db = openDb(":memory:");
    missions = new MissionRepo(db);
    injected = [];
    injectedTokens = [];
    now = 1_000_000;
    const settings = new SettingsStore(db);
    // Auto-schedulers off by default in tests (each scheduler test enables its own)
    // so fetch-script sequences stay deterministic.
    settings.update({ manusApiKey: "TESTKEY", manusAutoDeepdiveMin: 0 });
    svc = {
      settings,
      missions,
      attention: { injectResult: (rec: { mint: string; source: string; scores: { attention: number } }) => injected.push({ mint: rec.mint, source: rec.source, attention: rec.scores.attention }) },
      runtime: { injectToken: (t: { mint: string; symbol?: string; discoverySource?: string }) => injectedTokens.push(t) },
      paperPositions: { byStatus: () => [{ mint: "Cc7vCWVQ7AqHxuJYYQFr2Wj1GS66WQfPZcknvBTpump", symbol: "HELD" }] },
      signals: {
        recent: () => [
          { mint: "SeedMint11111111111111111111111111111111111", symbol: "SEED", verdict: "WATCH_ONLY", conviction: 52, flags: ["src:scan"], at: now - 60_000 },
          // pump.fun newborn (no DEX pair, no src:scan) — must be EXCLUDED from seeds:
          // bonding-curve coins structurally fail the playbook (curve holds authority+supply).
          { mint: "NewbornMint111111111111111111111111111111111", symbol: "BORN", verdict: "BUY_SMALL", conviction: 60, flags: [], at: now - 60_000 },
        ],
      },
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

  it("DISCOVERY: candidates are injected into the pipeline with research attached; invalid addresses skipped", async () => {
    const validA = "Cc7vCWVQ7AqHxuJYYQFr2Wj1GS66WQfPZcknvBTpump";
    const validB = "8JBkyLF1HXCNPgy9yyhRFcXCjYkbTxBCif25CSKfpump";
    const f = fetchScript([
      { status: 200, body: { ok: true, task_id: "TD", task_url: "u" } },
      { status: 200, body: { events: [
        { type: "structured_output_result", success: true, value: { candidates: [
          { contractAddress: validA, ticker: "$WIF2", narrative: "dog in a hat again", whyItMoons: "mid-tier callers picking it up", bearCase: "copycat", humanityScore: 80, viralityScore: 70, outsideCryptoScore: 40, culturalStrengthScore: 60, attentionScore: 72, confidence: 70 },
          { contractAddress: validB, ticker: "CAT", narrative: "cat meme", whyItMoons: "tiktok sound trending", bearCase: "thin", humanityScore: 60, viralityScore: 80, outsideCryptoScore: 55, culturalStrengthScore: 50, attentionScore: 65, confidence: 60 },
          { contractAddress: "not-a-real-address", ticker: "SCAM", narrative: "x", whyItMoons: "y", bearCase: "z", humanityScore: 1, viralityScore: 1, outsideCryptoScore: 1, culturalStrengthScore: 1, attentionScore: 1, confidence: 1 },
        ], rejectedCount: 34, marketNote: "choppy" } },
        { type: "status_update", agent_status: "stopped" },
      ] } },
    ]);
    const r = runner(f);
    const d = await r.dispatchDiscovery("operator");
    expect(d.ok).toBe(true);
    await r.pollOnce();
    const row = missions.get(d.id!)!;
    expect(row.status).toBe("resolved");
    expect(row.kind).toBe("discovery");
    expect((row.resultRaw as { rejectedCount: number }).rejectedCount).toBe(34); // full audit trail kept
    // 2 valid candidates injected into the pipeline, the garbage address skipped.
    expect(injectedTokens.map((t) => t.mint)).toEqual([validA, validB]);
    expect(injectedTokens[0].discoverySource).toBe("manus");
    expect(injectedTokens[0].symbol).toBe("WIF2"); // $ stripped
    // Research pre-attached so the readiness gate sees them as researched.
    expect(injected.map((i) => i.mint)).toEqual([validA, validB]);
    expect(injected[0].source).toBe("manus");
    expect(injected[0].attention).toBe(72);
  });

  it("DISCOVERY: the hunt prompt is SEEDED with the engine's live shortlist", async () => {
    const f = fetchScript([{ status: 200, body: { ok: true, task_id: "TS" } }]);
    const r = runner(f);
    await r.dispatchDiscovery("operator");
    const body = JSON.parse((f as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.message.content).toContain("SeedMint11111111111111111111111111111111111");
    expect(body.message.content).toMatch(/our local scanner watches pump\.fun/);
    expect(body.message.content).toMatch(/graduated — real Raydium pool/);
    // Bonding-curve newborns are NEVER seeded (they structurally fail the playbook).
    expect(body.message.content).not.toContain("NewbornMint111111111111111111111111111111111");
  });

  it("AUTO DEEP-DIVE scheduling: batched review of open positions on its own interval (run it all)", async () => {
    (svc.settings as SettingsStore).update({ manusDiscoveryEnabled: false, manusAutoDeepdiveMin: 120 });
    const f = fetchScript([
      { status: 200, body: { ok: true, task_id: "TDD" } }, // deep-dive dispatch
      { status: 200, body: { events: [{ type: "status_update", status_update: { agent_status: "running" } }] } },
    ]);
    const r = runner(f);
    await r.pollOnce(); // schedules + dispatches the deep-dive of the open position
    const dds = missions.recent(10).filter((m) => m.kind === "deepdive");
    expect(dds).toHaveLength(1);
    expect(dds[0].status).toBe("sent");
    await r.pollOnce(); // one in flight → no double dispatch
    expect(missions.recent(10).filter((m) => m.kind === "deepdive")).toHaveLength(1);
  });

  it("DISCOVERY scheduling: never doubles up while one is in flight", async () => {
    (svc.settings as SettingsStore).update({ manusDiscoveryEnabled: true, manusDiscoveryIntervalMin: 60 });
    const f = fetchScript([
      { status: 200, body: { ok: true, task_id: "TD1" } }, // dispatch
      { status: 200, body: { events: [{ type: "status_update", agent_status: "running" }] } }, // poll: still running
      { status: 200, body: { events: [{ type: "status_update", agent_status: "running" }] } },
    ]);
    const r = runner(f);
    await r.pollOnce(); // dispatches discovery #1
    expect(missions.recent(10).filter((m) => m.kind === "discovery")).toHaveLength(1);
    await r.pollOnce(); // one in flight → no new dispatch
    expect(missions.recent(10).filter((m) => m.kind === "discovery")).toHaveLength(1);
  });

  it("CONTINUOUS chaining: the next hunt dispatches IMMEDIATELY after a result lands (no timer)", async () => {
    (svc.settings as SettingsStore).update({ manusDiscoveryEnabled: true, manusDiscoveryIntervalMin: 60 });
    const f = fetchScript([
      { status: 200, body: { ok: true, task_id: "TD1" } }, // dispatch hunt 1
      { status: 200, body: { events: [
        { type: "structured_output_result", success: true, value: { candidates: [], rejectedCount: 3, marketNote: "dry" } },
        { type: "status_update", agent_status: "stopped" },
      ] } }, // hunt 1 resolves
      { status: 200, body: { ok: true, task_id: "TD2" } }, // hunt 2 chains immediately
      { status: 200, body: { events: [{ type: "status_update", agent_status: "running" }] } },
    ]);
    const r = runner(f);
    await r.pollOnce(); // dispatch #1 + resolve it in the same tick
    expect(missions.recent(10).filter((m) => m.kind === "discovery" && m.status === "resolved")).toHaveLength(1);
    await r.pollOnce(); // chains hunt #2 right away — interval is NOT waited
    expect(missions.recent(10).filter((m) => m.kind === "discovery")).toHaveLength(2);
  });

  it("DEEPDIVE: batched per-coin verdicts are applied through the advisory path", async () => {
    const a = "Cc7vCWVQ7AqHxuJYYQFr2Wj1GS66WQfPZcknvBTpump";
    const b = "8JBkyLF1HXCNPgy9yyhRFcXCjYkbTxBCif25CSKfpump";
    const f = fetchScript([
      { status: 200, body: { ok: true, task_id: "TX" } },
      { status: 200, body: { events: [
        { type: "structured_output_result", success: true, value: { results: [
          { contractAddress: a, recommendation: "confirm", confidence: 80, humanityScore: 70, viralityScore: 70, outsideCryptoScore: 50, culturalStrengthScore: 60, attentionScore: 68, narrative: "still spreading", keyFinding: "TG active", bearCase: "crowding" },
          { contractAddress: b, recommendation: "avoid", confidence: 90, humanityScore: 10, viralityScore: 5, outsideCryptoScore: 5, culturalStrengthScore: 10, attentionScore: 8, narrative: "attention dead", keyFinding: "dev selling", bearCase: "rug pattern" },
        ] } },
        { type: "status_update", agent_status: "stopped" },
      ] } },
    ]);
    const r = runner(f);
    const d = await r.dispatchDeepdive([{ mint: a, symbol: "AAA" }, { mint: b, symbol: "BBB" }], "operator");
    expect(d.ok).toBe(true);
    await r.pollOnce();
    expect(missions.get(d.id!)!.status).toBe("resolved");
    expect(injected).toHaveLength(2);
    expect(injected[0]).toMatchObject({ mint: a, source: "manus", attention: 68 });
    expect(injected[1]).toMatchObject({ mint: b, source: "manus", attention: 8 }); // avoid verdict lands too
  });

  it("UNSTRUCTURED chat answer: mints are extracted from Manus's TEXT and ingested (the operator-run-chat case)", async () => {
    const validA = "Cc7vCWVQ7AqHxuJYYQFr2Wj1GS66WQfPZcknvBTpump";
    const f = fetchScript([
      { status: 200, body: { ok: true, task_id: "TC" } },
      { status: 200, body: { events: [
        { type: "status_update", agent_status: "stopped" },
        { type: "assistant_message", content: `Here are my picks bruda: $BREAD looks great, contract ${validA}. The rest failed RugCheck.` },
      ] } },
    ]);
    const r = runner(f);
    const d = await r.dispatchDiscovery("operator"); // simulates an attached task too (same poll path)
    await r.pollOnce();
    const row = missions.get(d.id!)!;
    expect(row.status).toBe("resolved"); // NOT failed — the chat text was ingested
    expect((row.resultRaw as { unstructured: boolean; mints: string[] }).unstructured).toBe(true);
    expect((row.resultRaw as { mints: string[] }).mints).toEqual([validA]);
    expect(injectedTokens.map((t) => t.mint)).toEqual([validA]);
    expect(injected[0]).toMatchObject({ mint: validA, source: "manus" });
  });

  it("WAITING task gets auto-nudged with 'continue' (Manus pauses on login walls and sits forever)", async () => {
    const f = fetchScript([
      { status: 200, body: { ok: true, task_id: "TW" } }, // dispatch
      { status: 200, body: { events: [{ type: "status_update", status_update: { agent_status: "waiting" } }] } }, // poll: waiting
      { status: 200, body: { ok: true } }, // sendMessage nudge
      { status: 200, body: { events: [{ type: "status_update", status_update: { agent_status: "waiting" } }] } }, // poll 2
      { status: 200, body: { ok: true } }, // nudge 2
    ]);
    const r = runner(f);
    const d = await r.dispatchDiscovery("operator");
    await r.pollOnce();
    await r.pollOnce();
    const calls = (f as ReturnType<typeof vi.fn>).mock.calls;
    const nudges = calls.filter(([url]) => String(url).includes("task.sendMessage"));
    expect(nudges).toHaveLength(2);
    expect(JSON.parse(nudges[0][1].body).message.content).toMatch(/continue/);
    expect(missions.get(d.id!)!.status).toBe("sent"); // still polling, not failed
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
