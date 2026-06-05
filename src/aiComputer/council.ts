import Anthropic from "@anthropic-ai/sdk";
import type { CouncilRole } from "../council/roles.js";
import { buildSystemPrompt, buildEvidencePrompt, parseVerdict, type CouncilEvidence, type CouncilVerdict } from "./councilShared.js";

// The Anthropic council seat. Reviews ONLY the engine's pre-digested evidence
// from its assigned role and returns a small-weight confirm/caution verdict — it
// is NEVER the final decision and can never override the safety gate. Optional
// (needs a key); returns undefined without one or on any error.

export type { CouncilVerdict } from "./councilShared.js";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export async function anthropicReview(
  evidence: CouncilEvidence,
  opts: { apiKey?: string; role: CouncilRole; model?: string },
): Promise<CouncilVerdict | undefined> {
  if (!opts.apiKey) return undefined;
  try {
    const client = new Anthropic({ apiKey: opts.apiKey });
    const res = await client.messages.create({
      model: opts.model || DEFAULT_MODEL,
      max_tokens: 300,
      system: [{ type: "text", text: buildSystemPrompt(opts.role), cache_control: { type: "ephemeral" } }] as unknown as Anthropic.MessageCreateParams["system"],
      messages: [{ role: "user", content: `Evidence:\n${buildEvidencePrompt(evidence)}\n\nReview as strict JSON from your seat.` }],
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    return parseVerdict(text);
  } catch {
    return undefined;
  }
}
