import { describe, it, expect } from "vitest";
import { computeHeuristicHype, type NarrativeBucket } from "./heuristicScorer.js";

const NARRATIVES: NarrativeBucket[] = [
  { tag: "animal", keywords: ["dog", "wif", "pepe", "cat"] },
  { tag: "political", keywords: ["trump", "maga"] },
];
const KNOWN = ["pepe", "doge", "wif"];

describe("computeHeuristicHype", () => {
  it("rewards a strong narrative + revival match", () => {
    const r = computeHeuristicHype({ name: "Baby Pepe", symbol: "BPEPE" }, NARRATIVES, KNOWN);
    expect(r.tags).toContain("animal");
    expect(r.isRevival).toBe(true);
    expect(r.score).toBeGreaterThan(60);
    expect(r.source).toBe("heuristic");
  });

  it("scores a generic random name low", () => {
    const r = computeHeuristicHype({ name: "Xqz Token", symbol: "XQZ" }, NARRATIVES, KNOWN);
    expect(r.tags).toHaveLength(0);
    expect(r.isRevival).toBe(false);
    expect(r.score).toBeLessThan(50);
  });

  it("matches multiple narratives", () => {
    const r = computeHeuristicHype({ name: "Trump Dog", symbol: "TRUMPDOG" }, NARRATIVES, KNOWN);
    expect(r.tags).toEqual(expect.arrayContaining(["animal", "political"]));
  });
});
