import { describe, it, expect } from "vitest";
import { RESEARCH_LANES } from "./researchAgent.js";

// The parallel research fan-out is only as good as its lane registry: every lane
// must be uniquely identified (the cam keys panes by id) and on its OWN
// agent-browser session (shared sessions would fight over one browser).

describe("RESEARCH_LANES registry", () => {
  it("covers the operator's named sources + others", () => {
    const ids = RESEARCH_LANES.map((l) => l.id);
    for (const want of ["google", "x", "reddit", "brave", "ddg"]) expect(ids).toContain(want);
    expect(RESEARCH_LANES.length).toBeGreaterThanOrEqual(5);
  });

  it("every lane has a unique id, unique session, label, and run()", () => {
    const ids = new Set<string>();
    const sessions = new Set<string>();
    for (const l of RESEARCH_LANES) {
      expect(l.id).toBeTruthy();
      expect(l.label).toBeTruthy();
      expect(typeof l.run).toBe("function");
      expect(l.session.startsWith("mirofish-lane-")).toBe(true);
      expect(ids.has(l.id)).toBe(false);
      expect(sessions.has(l.session)).toBe(false);
      ids.add(l.id);
      sessions.add(l.session);
    }
  });
});
