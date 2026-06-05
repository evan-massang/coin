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

/** Per-seat instruction appended to the shared council system prompt. */
export const ROLE_PROMPT: Record<CouncilRole, string> = {
  bull_analyst:
    "Your seat: BULL ANALYST. Argue the strongest LEGITIMATE bull case — real organic demand, smart-money entry, durable narrative. score = how compelling the bull case actually is (score low and say 'caution' if there is no real bull case).",
  narrative_analyst:
    "Your seat: NARRATIVE ANALYST. Judge social/narrative momentum and meme quality only. score = narrative strength (low when the narrative is weak, derivative, or absent).",
  risk_analyst:
    "Your seat: RISK ANALYST. Hunt failure modes — rug patterns, thin liquidity, dev dumps, bundled/sniper clusters, unverified data. score = SAFETY (HIGH means LOW risk; LOW means dangerous). Say 'caution' whenever risk is material.",
  contrarian:
    "Your seat: CONTRARIAN. Try to DISPROVE the bull case and the cluster / smart-money signals. score = how much conviction SURVIVES your scrutiny (low if the bull case collapses under pressure).",
  lead_reviewer:
    "Your seat: LEAD REVIEWER. Give one balanced second opinion weighing bull and bear evidence even-handedly. score = overall favourability.",
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
