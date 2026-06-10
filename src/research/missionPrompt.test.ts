import { describe, it, expect } from "vitest";
import { missionToPrompt, MANUS_RECOMMENDATION_SCHEMA } from "./missionPrompt.js";
import type { Mission } from "./mission.types.js";

const mission: Mission = {
  mint: "MINT1",
  symbol: "DOGE",
  objective: "Verdict WATCH_ONLY at conviction 49. Decide whether ATTENTION will GROW…",
  verdict: "WATCH_ONLY",
  conviction: 49,
  buckets: [
    { key: "rugcheck", known: ["safety gate PASS"], coverage: 1, thin: false },
    { key: "attention", known: ["not researched yet"], coverage: 0, thin: true },
  ],
  gaps: ["attention"],
  outputContract: "strict json",
  createdAt: 1,
};

// Manus's structured-output subset: root object, additionalProperties:false on
// every object, max depth 5, and NO unsupported constraint keywords.
const FORBIDDEN_KEYWORDS = ["pattern", "format", "minimum", "maximum", "allOf", "oneOf", "if", "then", "else", "minLength", "maxLength", "minItems", "maxItems"];

function check(node: unknown, depth: number, path: string, problems: string[]): void {
  if (!node || typeof node !== "object") return;
  if (depth > 5) problems.push(`${path}: depth ${depth} > 5`);
  const o = node as Record<string, unknown>;
  for (const k of FORBIDDEN_KEYWORDS) if (k in o) problems.push(`${path}: forbidden keyword "${k}"`);
  if (o.type === "object") {
    if (o.additionalProperties !== false) problems.push(`${path}: object without additionalProperties:false`);
    const props = (o.properties ?? {}) as Record<string, unknown>;
    if (Array.isArray(o.required)) {
      for (const r of o.required as string[]) if (!(r in props)) problems.push(`${path}: required "${r}" not in properties`);
    }
    for (const [k, v] of Object.entries(props)) check(v, depth + 1, `${path}.${k}`, problems);
  }
  if (o.type === "array") check(o.items, depth + 1, `${path}[]`, problems);
}

describe("MANUS_RECOMMENDATION_SCHEMA", () => {
  it("conforms to the Manus structured-output subset (strict objects, no forbidden keywords, depth ≤ 5)", () => {
    const problems: string[] = [];
    expect((MANUS_RECOMMENDATION_SCHEMA as { type: string }).type).toBe("object");
    check(MANUS_RECOMMENDATION_SCHEMA, 1, "$", problems);
    expect(problems).toEqual([]);
  });

  it("requires the bear case — the thesis must be attacked, not just defended", () => {
    expect(MANUS_RECOMMENDATION_SCHEMA.required).toContain("bearCase");
    expect(MANUS_RECOMMENDATION_SCHEMA.properties.recommendation.enum).toEqual(["confirm", "caution", "unsure", "avoid"]);
  });
});

describe("missionToPrompt", () => {
  it("renders mint, objective, thin-bucket markers, gaps, and the advisory note", () => {
    const p = missionToPrompt(mission);
    expect(p).toContain("MINT1");
    expect(p).toContain(mission.objective);
    expect(p).toContain("THIN, VERIFY THIS"); // the thin attention bucket
    expect(p).toContain("PRIORITY GAPS TO CLOSE: attention");
    expect(p).toMatch(/ADVISORY ONLY/);
    expect(p).toMatch(/cannot force a buy/);
  });

  it("is deterministic for the same mission", () => {
    expect(missionToPrompt(mission)).toBe(missionToPrompt(mission));
  });
});
