import type { Mission } from "./mission.types.js";

// Renders a Mission into the prompt sent to Manus (task.create message.content)
// and defines the structured-output schema Manus must answer with. The schema
// uses Manus's strict JSON-Schema subset: root object, additionalProperties:false
// everywhere, max depth 5, NO pattern/format/minimum/maximum keywords — ranges
// are expressed in descriptions instead.

/** The exact response contract — same shape as MissionResult, enforced by Manus. */
export const MANUS_RECOMMENDATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    recommendation: {
      type: "string",
      enum: ["confirm", "caution", "unsure", "avoid"],
      description: "confirm = thesis supported, attention likely to GROW in the next 2-12h; caution = mixed/weak; unsure = could not establish; avoid = scam signals or thesis refuted",
    },
    confidence: { type: "number", description: "0-100, how confident you are in the recommendation" },
    scores: {
      type: "object",
      additionalProperties: false,
      properties: {
        humanity: { type: "number", description: "0-100: are REAL humans engaging (unique posters, diverse writing styles, original memes) vs bot farms / copy-paste shills" },
        virality: { type: "number", description: "0-100: is attention SPREADING and accelerating right now (velocity + acceleration, not just current volume)" },
        outsideCrypto: { type: "number", description: "0-100: does the meme exist OUTSIDE crypto (mainstream news/TikTok/celebrity/real-world event)" },
        culturalStrength: { type: "number", description: "0-100: meme/narrative quality — why it exists, why it is funny, why people would share it" },
        attention: { type: "number", description: "0-100 composite attention score" },
      },
      required: ["humanity", "virality", "outsideCrypto", "culturalStrength", "attention"],
    },
    narrative: { type: "string", description: "one line: why this meme exists and why attention may grow (or why not)" },
    reasons: { type: "array", items: { type: "string" }, description: "3-8 evidence-backed bullets, each citing what you actually found (platform, count, link)" },
    bullCase: { type: "string", description: "the strongest case FOR attention growth" },
    bearCase: { type: "string", description: "the strongest case AGAINST — failure modes, contradictory evidence. Required: try to invalidate the thesis." },
  },
  required: ["recommendation", "confidence", "scores", "narrative", "reasons", "bullCase", "bearCase"],
} as const;

/** Render the mission as the Manus task prompt. */
export function missionToPrompt(m: Mission): string {
  const lines: string[] = [];
  const p = (s = "") => lines.push(s);
  p(`MEME-COIN ATTENTION RESEARCH MISSION — $${m.symbol ?? m.mint.slice(0, 6)} (Solana mint: ${m.mint})`);
  p();
  p(`OBJECTIVE: ${m.objective}`);
  p();
  p(`We are NOT looking for long-term investments. The asset is ATTENTION: decide whether human attention on this meme will GROW within the next 2-12 hours before it collapses. Current local verdict: ${m.verdict} at conviction ${m.conviction}/100.`);
  p();
  p(`WHAT THE ENGINE ALREADY KNOWS (do not redo this — verify the thin parts):`);
  for (const b of m.buckets) {
    p(`- ${b.key.toUpperCase()} [coverage ${Math.round(b.coverage * 100)}%${b.thin ? " — THIN, VERIFY THIS" : ""}]`);
    for (const k of b.known) p(`    · ${k}`);
  }
  p();
  if (m.gaps.length) p(`PRIORITY GAPS TO CLOSE: ${m.gaps.join(", ")}`);
  p();
  p(`RESEARCH PROCESS:`);
  p(`1. RUG / SAFETY: check RugCheck + holder concentration for this mint. Reject immediately (recommendation=avoid) on: active mint/freeze authority, unlocked+unburned LP, single wallet >5%, bundled-supply warnings. Do not defend weak candidates.`);
  p(`2. CHART: DexScreener/GeckoTerminal — has it already done a huge vertical move / been discovered? Prefer early accumulation; reject exit liquidity.`);
  p(`3. SOCIAL: search Twitter/X, Telegram, Reddit, TikTok, YouTube, news for the ticker + meme name. Are REAL humans participating (different writing styles, original memes, actual discussion) or bot farms / copy-paste shills?`);
  p(`4. NARRATIVE: why does this meme exist? Why is it funny? What real-world event, joke, trend, or personality is attached? Reject price-only narratives.`);
  p(`5. ATTENTION TRAJECTORY: focus on FUTURE attention — velocity and acceleration of mentions, emerging communities, small/mid influencer pickups (a trade already saturated by large influencers is crowded).`);
  p(`6. BEAR CASE: actively try to invalidate the thesis. Report contradictory evidence honestly.`);
  p();
  p(`Your answer is ADVISORY ONLY: the engine maps it onto one research facet and re-scores through its hard safety gates — it cannot force a buy. Be ruthless about weak candidates; a false 'confirm' costs money, a false 'avoid' costs nothing.`);
  p();
  p(`Respond with the structured output exactly matching the provided schema.`);
  return lines.join("\n");
}
