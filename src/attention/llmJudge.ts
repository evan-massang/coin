import { ollamaChat } from "../aiComputer/ollamaCouncil.js";
import type { AttentionEvidence, AttentionScores } from "./types.js";
import { clamp, clamp01 } from "./types.js";
import { ATTENTION_WEIGHTS } from "./attentionAgent.js";

// Phase 8/9 — Local-LLM judge + philosophical attention reasoner. Turns collected
// evidence into a deeper read using a LOCAL model (Ollama: Qwen/DeepSeek/Gemma —
// free, private, no cloud). If no model is configured or it fails, the caller
// falls back to the deterministic heuristic agents. Never throws.

const SYSTEM = `You are a cultural & attention analyst for meme coins. Core thesis: ATTENTION PRECEDES PRICE. Judge ONLY from the evidence given — do not invent facts. Be skeptical: identical/copy-paste chatter and one account posting repeatedly is NOT humanity (it's a bot farm); a coin that's only discussed in a trading frame has LOW outside-crypto value; a meme that exists as a real-world joke/clip has HIGH ceiling. Output a STRICT JSON object only.`;

function buildUser(ev: AttentionEvidence): string {
  const lines = ev.posts
    .slice(0, 40)
    .map((p) => `[${p.platform}${p.author ? " @" + p.author : ""}] ${p.text.slice(0, 160)}`)
    .join("\n");
  return (
    `Coin: ${ev.name ?? ev.symbol ?? "?"} ($${ev.symbol ?? "?"})\n` +
    `Platforms with presence: ${ev.platforms.join(", ") || "none"}\n` +
    `Evidence (${ev.posts.length} items):\n${lines || "(no public chatter found)"}\n\n` +
    `Questions to reason through:\n` +
    `1) Would people share this if money didn't exist?\n` +
    `2) What tribe/identity owns it, and what emotion spreads it?\n` +
    `3) Does it exist OUTSIDE crypto (real-world meme/clip/trend)?\n` +
    `4) Is attention likely RISING in the next 1-12h, or dying?\n` +
    `5) What is the strongest argument AGAINST this meme succeeding?\n\n` +
    `Output JSON ONLY: {"humanity":0-100,"virality":0-100,"outsideCrypto":0-100,"culturalStrength":0-100,"confidence":0-100,"reasoning":"one sentence","counterargument":"one sentence"}`
  );
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 50;
}

function extractJson(text: string): Record<string, unknown> | undefined {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return undefined;
  try {
    return JSON.parse(text.slice(s, e + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Judge attention with a local model. Returns undefined ⇒ caller uses heuristic. */
export async function judgeAttention(ev: AttentionEvidence, baseUrl: string, model: string, timeoutMs = 60_000): Promise<AttentionScores | undefined> {
  if (!model || ev.posts.length === 0) return undefined;
  const out = await ollamaChat(baseUrl, model, SYSTEM, buildUser(ev), timeoutMs);
  if (!out) return undefined;
  const j = extractJson(out);
  if (!j) return undefined;

  const humanity = clamp(num(j.humanity));
  const virality = clamp(num(j.virality));
  const outsideCrypto = clamp(num(j.outsideCrypto));
  const culturalStrength = clamp(num(j.culturalStrength));
  const confidence = clamp01(num(j.confidence) / 100);
  const attention = clamp(
    humanity * ATTENTION_WEIGHTS.humanity +
      virality * ATTENTION_WEIGHTS.virality +
      outsideCrypto * ATTENTION_WEIGHTS.outsideCrypto +
      culturalStrength * ATTENTION_WEIGHTS.culturalStrength,
  );
  const reasons = [j.reasoning, j.counterargument ? `counter: ${String(j.counterargument)}` : ""]
    .filter(Boolean)
    .map((r) => String(r).slice(0, 200));

  return {
    humanity,
    virality,
    outsideCrypto,
    culturalStrength,
    attention,
    confidence,
    tags: [],
    narrative: `LLM judge: attention ${Math.round(attention)} — ${String(j.reasoning ?? "").slice(0, 120)}`,
    reasons,
  };
}
