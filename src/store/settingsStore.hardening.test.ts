import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, type DB } from "./db.js";
import { SettingsStore } from "./settingsStore.js";

// V5.1 red-team hardening: the conviction gate has a server-side FLOOR, advisory
// weights have CEILINGS, non-finite numbers are rejected, and one corrupt stored
// row can no longer reset every setting to defaults.

describe("SettingsStore hardening", () => {
  let db: DB;
  let s: SettingsStore;
  beforeEach(() => {
    db = openDb(":memory:");
    s = new SettingsStore(db);
  });
  afterEach(() => db.close());

  it("REJECTS lowering the conviction gate below its floor (never lower the gate)", () => {
    expect(() => s.update({ minConvictionBuySmall: 40 })).toThrow();
    expect(() => s.update({ minConvictionBuyStrong: 60 })).toThrow();
    expect(s.get("minConvictionBuySmall")).toBe(55); // unchanged
    s.update({ minConvictionBuySmall: 60 }); // raising is allowed
    expect(s.get("minConvictionBuySmall")).toBe(60);
  });

  it("REJECTS weighting an advisory facet past its ceiling (hype stays small by design)", () => {
    expect(() => s.update({ weightHype: 50 })).toThrow();
    expect(() => s.update({ weightSocial: 80 })).toThrow();
    expect(() => s.update({ weightMomentum: 200 })).toThrow();
    s.update({ weightHype: 10 }); // within ceiling
    expect(s.get("weightHype")).toBe(10);
  });

  it("REJECTS non-finite numbers (Infinity used to corrupt the store via JSON null)", () => {
    expect(() => s.update({ paperMaxPositionSol: Infinity })).toThrow(/finite/);
    expect(() => s.update({ baseRiskPct: Number.NaN })).toThrow();
  });

  it("one corrupt stored row no longer resets EVERYTHING — per-key salvage", () => {
    s.update({ paperStartingBalanceSol: 38, minConviction: 70 });
    // Corrupt ONE row directly (simulates the old Infinity→"null" footgun).
    db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('maxRiskPct','null',0) ON CONFLICT(key) DO UPDATE SET value='null'").run();
    const fresh = new SettingsStore(db); // new instance = cold read like a reboot
    expect(fresh.get("maxRiskPct")).toBe(2); // ONLY the bad key fell to default…
    expect(fresh.get("paperStartingBalanceSol")).toBe(38); // …good keys survive
    expect(fresh.get("minConviction")).toBe(70);
  });

  it("manusApiKey is registered as a secret (never leaves redacted() as a value)", () => {
    s.update({ manusApiKey: "super-secret" });
    const red = s.redacted();
    expect(red.manusApiKey).toBe(true); // boolean presence, not the value
  });
});
