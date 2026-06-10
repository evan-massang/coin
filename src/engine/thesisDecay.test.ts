import { describe, it, expect } from "vitest";
import { thesisDecayFlags } from "./exitEngine.js";

// Hermes Phase 13/14 — advisory thesis-decay annotation. Pure + never blocking:
// it can only ADD flags to an exit alert, never change exit behavior.

describe("thesisDecayFlags", () => {
  it("intact when attention held or grew", () => {
    expect(thesisDecayFlags(70, 70)).toEqual([]);
    expect(thesisDecayFlags(80, 70)).toEqual([]);
    expect(thesisDecayFlags(64, 70)).toEqual([]); // -6: within noise
  });
  it("weakening between -9 and -19", () => {
    expect(thesisDecayFlags(58, 70)).toEqual(["thesis-weakening"]);
    expect(thesisDecayFlags(51, 70)).toEqual(["thesis-weakening"]);
  });
  it("broken at -20 or worse", () => {
    expect(thesisDecayFlags(50, 70)).toEqual(["thesis-broken"]);
    expect(thesisDecayFlags(10, 92)).toEqual(["thesis-broken"]);
  });
  it("silent when either side is unknown or the entry was unresearched", () => {
    expect(thesisDecayFlags(undefined, 70)).toEqual([]);
    expect(thesisDecayFlags(50, undefined)).toEqual([]);
    expect(thesisDecayFlags(50, 0)).toEqual([]); // entry attention 0 = never researched
  });
});
