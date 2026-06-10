import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Council roles + member registry. The AI council is a PANEL of specialised
// analysts, each given a different seat (perspective) over the SAME evidence the
// engine already produced. It is advisory only — it can never place a trade,
// move funds, change a score, or override the Safety Gate / Risk Engine. Every
// seat still rates honestly: a "bull analyst" must score low when there is no
// real bull case. score is always "higher = more favourable" so the consensus
// can average across seats consistently.
// ─────────────────────────────────────────────────────────────────────────────

export type CouncilRole =
  | "bull_analyst"
  | "narrative_analyst"
  | "risk_analyst"
  | "contrarian"
  | "lead_reviewer";

export const ROLE_LABEL: Record<CouncilRole, string> = {
  bull_analyst: "Bull Analyst",
  narrative_analyst: "Narrative Analyst",
  risk_analyst: "Risk Analyst",
  contrarian: "Contrarian",
  lead_reviewer: "Lead Reviewer",
};

/** Per-seat instruction appended to the shared council system prompt.
 *
 *  REWRITTEN per the operator's 5,543-opinion teardown: "you are the bull
 *  analyst" made small models PERFORM bullishness (qwen: CONFIRM 1104/1128).
 *  The persona now shapes WHAT EVIDENCE the seat looks for, never what
 *  conclusion it reaches — every seat must cite specific evidence from the
 *  input and is explicitly free (obliged) to reject. */
export const ROLE_PROMPT: Record<CouncilRole, string> = {
  bull_analyst:
    "Your seat gathers the case FOR buying. List the strongest SPECIFIC evidence in the input that supports buying (organic demand, smart money, durable narrative), then score how strong that case actually is. No real supporting evidence in the input = score under 35 and reject. Your seat does NOT owe anyone a confirm.",
  narrative_analyst:
    "Your seat gathers narrative/meme evidence ONLY. Cite the specific narrative facts in the input; score how strong the narrative case is. No narrative evidence present = score under 35 and reject — do not output a default midpoint.",
  risk_analyst:
    "Your seat gathers FAILURE-MODE evidence: rug patterns, thin liquidity, dev dumps, cluster buys, unverified data. Cite the specific red flags found; score = SAFETY (high only when you found real evidence of safety, not when you found nothing). Material risk found = reject.",
  contrarian:
    "Your seat attacks the bull case. Quote the specific claims in the input and say what refutes or survives. score = how much of the case SURVIVES your attack. If the case collapses, score under 35 and reject; if you genuinely cannot attack it, score high — both are useful, a permanent 50 is not.",
  lead_reviewer:
    "Your seat weighs the OTHER seats' cited evidence. Score the overall case strictly from what was cited — uncited claims count as absent. You hold the panel's last word: reject freely; confirm ONLY when cited evidence clearly supports it.",
};

export const PROVIDERS = ["anthropic", "opencode"] as const;
export type CouncilProvider = (typeof PROVIDERS)[number];

export const CouncilMemberConfigSchema = z.object({
  /** Stable id, e.g. "claude", "gpt4o", "deepseek", "qwen". */
  id: z.string(),
  /** Display name in the Council Room. */
  label: z.string(),
  role: z.enum(["bull_analyst", "narrative_analyst", "risk_analyst", "contrarian", "lead_reviewer"]),
  /** How the member is called: directly via Anthropic SDK, or via the OpenCode router. */
  provider: z.enum(PROVIDERS),
  /** Provider/model id. For opencode: "openai/gpt-4o", "deepseek/deepseek-chat". Empty ⇒ provider default. */
  model: z.string().default(""),
  enabled: z.boolean().default(true),
});

export type CouncilMemberConfig = z.infer<typeof CouncilMemberConfigSchema>;

/**
 * Default roster. Claude runs out of the box (anthropic, needs only the existing
 * anthropicApiKey). The OpenCode seats are listed enabled but ONLY actually run
 * when the `opencodeEnabled` master switch is on AND the local OpenCode server is
 * reachable — so default behaviour is Claude-only.
 */
export const DEFAULT_COUNCIL: CouncilMemberConfig[] = [
  { id: "claude", label: "Claude", role: "bull_analyst", provider: "anthropic", model: "", enabled: true },
  { id: "gpt4o", label: "GPT-4o", role: "narrative_analyst", provider: "opencode", model: "openai/gpt-4o", enabled: true },
  { id: "deepseek", label: "DeepSeek", role: "risk_analyst", provider: "opencode", model: "deepseek/deepseek-chat", enabled: true },
  { id: "qwen", label: "Qwen", role: "contrarian", provider: "opencode", model: "qwen/qwen-max", enabled: true },
];
