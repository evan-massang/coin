import Anthropic from "@anthropic-ai/sdk";
import type { HypeResult } from "../types.js";
import { HYPE_SYSTEM, buildHypeUserPrompt } from "./prompts.js";
import type { HypeToken } from "./heuristicScorer.js";

// Optional Claude hype judge. Uses a cheap model + prompt caching on the static
// system block. Returns structured JSON; throws on failure so the caller can
// fall back to the free heuristic. Never the sole BUY trigger (small weight).

const MODEL = "claude-haiku-4-5-20251001";

export async function scoreWithLlm(token: HypeToken, apiKey: string): Promise<HypeResult> {
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    // cache_control prompt-caches the static system block (accepted by the API;
    // cast bridges a gap in this SDK version's TextBlockParam typing).
    system: [{ type: "text", text: HYPE_SYSTEM, cache_control: { type: "ephemeral" } }] as unknown as Anthropic.MessageCreateParams["system"],
    messages: [{ role: "user", content: buildHypeUserPrompt(token) }],
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = extractJson(text);

  const score = clampScore(parsed.score);
  return {
    score,
    isRevival: !!parsed.is_revival,
    source: "llm",
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "llm narrative judgement",
    tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === "string") : [],
  };
}

interface RawHype {
  score?: unknown;
  is_revival?: unknown;
  tags?: unknown;
  rationale?: unknown;
}

function extractJson(text: string): RawHype {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON in LLM response");
  return JSON.parse(text.slice(start, end + 1)) as RawHype;
}

function clampScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}
