import Anthropic from "@anthropic-ai/sdk";

// Evidence-only "second opinion" via the Anthropic API. It reviews the facts the
// engine already gathered and returns a small-weight confirm/caution signal — it
// is NEVER the final decision and can never override the safety gate. Optional
// (needs a key); returns undefined without one.

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM = `You are a second-opinion reviewer for a READ-ONLY Solana meme-coin signal engine.
You are given evidence the engine already collected (safety facts, liquidity, holders, momentum).
Give a brief risk review ONLY. You do not decide trades, you never tell the user to buy or sell,
and you cannot override the engine's safety gate.

Respond with STRICT JSON only:
{"score": <0-100 integer how clean/credible the token looks>, "recommendation": "confirm" | "caution", "rationale": "<one sentence>"}`;

export interface CouncilVerdict {
  score: number;
  recommendation: "confirm" | "caution";
  rationale: string;
}

export async function councilReview(evidence: string, apiKey?: string): Promise<CouncilVerdict | undefined> {
  if (!apiKey) return undefined;
  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }] as unknown as Anthropic.MessageCreateParams["system"],
      messages: [{ role: "user", content: `Evidence:\n${evidence}\n\nReview as strict JSON.` }],
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return undefined;
    const raw = JSON.parse(text.slice(start, end + 1)) as { score?: unknown; recommendation?: unknown; rationale?: unknown };
    const score = typeof raw.score === "number" ? Math.max(0, Math.min(100, Math.round(raw.score))) : 50;
    return {
      score,
      recommendation: raw.recommendation === "confirm" ? "confirm" : "caution",
      rationale: typeof raw.rationale === "string" ? raw.rationale : "council review",
    };
  } catch {
    return undefined;
  }
}
