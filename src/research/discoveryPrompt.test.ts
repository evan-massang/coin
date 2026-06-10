import { describe, it, expect } from "vitest";
import { discoveryPrompt, deepdivePrompt, DISCOVERY_SCHEMA, DEEPDIVE_SCHEMA } from "./discoveryPrompt.js";

// Manus structured-output subset: strict objects, no constraint keywords, depth ≤5.
const FORBIDDEN = ["pattern", "format", "minimum", "maximum", "allOf", "oneOf", "if", "then", "else", "minLength", "maxLength", "minItems", "maxItems"];

function check(node: unknown, depth: number, path: string, problems: string[]): void {
  if (!node || typeof node !== "object") return;
  if (depth > 5) problems.push(`${path}: depth ${depth} > 5`);
  const o = node as Record<string, unknown>;
  for (const k of FORBIDDEN) if (k in o) problems.push(`${path}: forbidden "${k}"`);
  if (o.type === "object") {
    if (o.additionalProperties !== false) problems.push(`${path}: object without additionalProperties:false`);
    const props = (o.properties ?? {}) as Record<string, unknown>;
    if (Array.isArray(o.required)) for (const r of o.required as string[]) if (!(r in props)) problems.push(`${path}: required "${r}" missing`);
    // Live-validator rule (probed, undocumented): EVERY property must be required.
    const req = new Set((o.required as string[]) ?? []);
    for (const k of Object.keys(props)) if (!req.has(k)) problems.push(`${path}: property "${k}" not in required (live Manus validator 400s on partial required)`);
    for (const [k, v] of Object.entries(props)) check(v, depth + 1, `${path}.${k}`, problems);
  }
  if (o.type === "array") check(o.items, depth + 1, `${path}[]`, problems);
}

describe("DISCOVERY_SCHEMA / DEEPDIVE_SCHEMA", () => {
  it("both conform to the Manus structured-output subset", () => {
    const p1: string[] = [];
    const p2: string[] = [];
    check(DISCOVERY_SCHEMA, 1, "$", p1);
    check(DEEPDIVE_SCHEMA, 1, "$", p2);
    expect(p1).toEqual([]);
    expect(p2).toEqual([]);
  });

  it("discovery candidates REQUIRE a contract address + bear case + confidence", () => {
    const items = DISCOVERY_SCHEMA.properties.candidates.items;
    expect(items.required).toContain("contractAddress");
    expect(items.required).toContain("bearCase");
    expect(items.required).toContain("confidence");
  });
});

describe("discoveryPrompt — the operator's prompt, VERBATIM (street voice, not engineer voice)", () => {
  const p = discoveryPrompt(5);
  it("opens exactly like the operator wrote it (engineer-voice rewrites made Manus ask for APIs)", () => {
    expect(p.startsWith("Go to DexScreener, filter Solana, sort by new pairs.")).toBe(true);
  });
  it("contains every hard filter, verbatim", () => {
    expect(p).toContain("Paste the contract into RugCheck.xyz. Mint authority revoked, freeze authority revoked, LP burned or locked.");
    expect(p).toContain("Top 10 holders under 25-30% combined (not counting the LP pool). No single wallet holding over 5%.");
    expect(p).toContain("At least $30-50k liquidity, minimum.");
    expect(p).toContain("$50k-500k market cap with real traction building");
  });
  it("contains the moon signals + the early-caller edge, verbatim", () => {
    expect(p).toContain("real humans posting, different writing styles, organic memes people made themselves");
    expect(p).toContain("Dead chat = dead coin.");
    expect(p).toContain("mid-tier callers with real track records are organically mentioning it");
  });
  it("contains the instant-pass red flags + the ape rule, verbatim", () => {
    expect(p).toContain("Anonymous team promising '100x guaranteed'");
    expect(p).toContain("Dev wallet selling on the chart");
    expect(p).toContain("Don't send me anything you wouldn't ape into yourself.");
  });
  it("asks for the requested candidate count + the contract addresses", () => {
    expect(discoveryPrompt(5)).toMatch(/top 5 that really have a high chance/);
    expect(p).toContain("give me the coin address too");
  });
  it("seeds ride along in the same casual voice", () => {
    const seeded = discoveryPrompt(5, [{ mint: "MintXYZ", symbol: "DOGE", note: "graduated" }]);
    expect(seeded).toContain("our local scanner watches pump.fun and DexScreener in real time");
    expect(seeded).toContain("MintXYZ");
    expect(seeded).toContain("skip them freely if they fail anything");
  });
});

describe("deepdivePrompt — batched, never one-at-a-time", () => {
  it("lists every coin with its exact mint and demands per-coin verdicts", () => {
    const p = deepdivePrompt([
      { mint: "MintAAAA", symbol: "DOGE", note: "open position" },
      { mint: "MintBBBB", symbol: "PEPE" },
    ]);
    expect(p).toMatch(/2 Solana meme coins/);
    expect(p).toContain("MintAAAA");
    expect(p).toContain("MintBBBB");
    expect(p).toMatch(/Return EVERY coin/);
    expect(p).toMatch(/mint address copied EXACTLY/);
  });
});
