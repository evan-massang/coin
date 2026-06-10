// Hermes Phase 3 — DISCOVERY missions: Manus is not reviewing a pre-selected
// coin; it independently hunts the Solana meme ecosystem using the OPERATOR'S
// playbook (operationalized verbatim below) and returns N candidates with
// contract addresses. Every returned mint is then injected into the local
// pipeline, which VERIFIES the claims itself (Stage-0 RugCheck etc.) and
// monitors from there — Manus proposes, the engine checks and decides.
//
// DEEPDIVE missions: the operator's "really hard opinion" ask — MANY tokens
// reviewed in ONE mission (batched for efficiency, never one-at-a-time).

/** Per-candidate response contract. Two LIVE-validator rules the docs omit
 *  (discovered by probing api.manus.ai directly, scripts/research/_probe_manus_schema*.mjs):
 *  EVERY property must be listed in `required` (strict mode, like OpenAI) — a
 *  partial required array is a 400. Flat score fields keep the items shallow. */
const CANDIDATE_PROPS = {
  contractAddress: { type: "string", description: "the Solana mint/contract address — REQUIRED, exact, no abbreviation" },
  ticker: { type: "string", description: "the $TICKER" },
  name: { type: "string", description: "coin name" },
  marketCapUsd: { type: "number", description: "market cap in USD right now" },
  liquidityUsd: { type: "number", description: "pool liquidity in USD right now" },
  holderCount: { type: "number", description: "current holder count" },
  rugcheckSummary: { type: "string", description: "RugCheck result: mint authority, freeze authority, LP lock/burn, top-10 holder %, any flags. Include the rugcheck.xyz link." },
  narrative: { type: "string", description: "one sentence: why this meme is funny/interesting and what live trend/event/character it is tied to" },
  whyItMoons: { type: "string", description: "why attention is likely to GROW in the next 2-12h: who is posting, velocity, which mid-tier callers picked it up" },
  humanityEvidence: { type: "string", description: "evidence real humans (not bots) are engaging: distinct writing styles, original memes, live TG/Discord chat. Include the X search link for the ticker." },
  bearCase: { type: "string", description: "the honest case against — what kills this coin" },
  humanityScore: { type: "number", description: "0-100 real humans vs bots" },
  viralityScore: { type: "number", description: "0-100 spreading velocity/acceleration" },
  outsideCryptoScore: { type: "number", description: "0-100 hook exists outside crypto" },
  culturalStrengthScore: { type: "number", description: "0-100 meme quality/identity" },
  attentionScore: { type: "number", description: "0-100 composite attention score" },
  confidence: { type: "number", description: "0-100: would YOU ape into this one? Be honest." },
} as const;

export const DISCOVERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidates: {
      type: "array",
      description: "the best candidates found, strongest first — ONLY coins that passed every hard filter",
      items: { type: "object", additionalProperties: false, properties: CANDIDATE_PROPS, required: Object.keys(CANDIDATE_PROPS) },
    },
    rejectedCount: { type: "number", description: "how many coins you reviewed and rejected" },
    marketNote: { type: "string", description: "one line on overall meme-market conditions right now" },
  },
  required: ["candidates", "rejectedCount", "marketNote"],
} as const;

/** The operator's hunting playbook, operationalized. */
export function discoveryPrompt(candidateCount: number): string {
  return `SOLANA MEME-COIN DISCOVERY MISSION — find the next runners BEFORE they run.

You are NOT reviewing a pre-selected coin. Hunt independently and return the top ${candidateCount} candidates with the highest chance of blowing up in the next hours. Review MANY coins (20-50+) and reject ruthlessly — report how many you rejected.

WHERE TO HUNT:
- DexScreener: filter Solana, sort by new pairs. Pump.fun "about to graduate" section — those already survived the worst rug phase. Photon/BullX trending if accessible.

HARD FILTER — before you even consider a coin (any fail = skip, no matter how good it looks):
1. Paste the contract into RugCheck.xyz: mint authority revoked, freeze authority revoked, LP burned or locked. All three or skip.
2. Top 10 holders under 25-30% combined (excluding the LP pool). No single wallet over 5%. No bundled-supply flag. Red or yellow on RugCheck → move on; there are a thousand other coins.
3. Liquidity at least $30-50k. Market cap $50k-$500k — NOT something that already pumped to $10M.
4. Real two-way volume (not just buys). Holder count growing steadily, not flat.
5. Chart has actual structure — if it already did a vertical 10x, we are exit liquidity. Skip.

WHAT TELLS YOU IT WILL ACTUALLY MOON:
- Search the ticker on X: real humans posting, different writing styles, organic memes people made themselves — NOT 50 bot accounts posting the same image with the same caption (paid shilling dies in hours).
- Telegram/Discord: open it. Actual people chatting, or "wen moon" spam and bots? Dead chat = dead coin.
- The meme itself has to hit: can you explain why it is funny or interesting in ONE sentence? Is it tied to something happening right now — a trend, an event, a character people know? Meme coins without a hook die in 72 hours; survivors have an identity people want to be part of.
- The edge: SMALLER/mid-tier Crypto Twitter accounts with real track records organically mentioning it BEFORE the big influencers. Once big names tweet it, their followers are the exit liquidity — we are late. If it is already trending on CT, we missed it.

RED FLAGS — instant pass:
- Anonymous team promising "100x guaranteed"
- Identical shill posts across multiple accounts
- Dev wallet selling on the chart
- Liquidity shrinking
- Chart already did a huge vertical move
- Only hype is about price; nobody talks about the actual meme

FOR EACH CANDIDATE RETURN: exact contract address, market cap + liquidity right now, the RugCheck summary (with link), why the narrative works, the X search link for the ticker, the honest bear case, and your 0-100 scores.

Do NOT send anything you would not ape into yourself. Your output is ADVISORY: the engine re-verifies every claim on-chain (RugCheck, holders, liquidity) and runs its own safety gates before any simulated position — a weak pick wastes everyone's time, so quality over quantity. Respond with the structured output exactly matching the provided schema.`;
}

// ── Batched deep-dive (the "really hard opinion" — many coins per mission) ──

export const DEEPDIVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          contractAddress: { type: "string", description: "the mint address EXACTLY as given in the mission" },
          recommendation: { type: "string", enum: ["confirm", "caution", "unsure", "avoid"], description: "confirm = attention growing, hold/add; avoid = thesis dead, get out" },
          confidence: { type: "number", description: "0-100" },
          humanityScore: { type: "number", description: "0-100 real humans vs bots" },
          viralityScore: { type: "number", description: "0-100 spreading velocity" },
          outsideCryptoScore: { type: "number", description: "0-100 hook outside crypto" },
          culturalStrengthScore: { type: "number", description: "0-100 meme quality" },
          attentionScore: { type: "number", description: "0-100 composite attention" },
          narrative: { type: "string", description: "one line: current state of the meme's attention" },
          keyFinding: { type: "string", description: "the single most decision-relevant thing you found" },
          bearCase: { type: "string", description: "what kills it from here" },
        },
        required: ["contractAddress", "recommendation", "confidence", "humanityScore", "viralityScore", "outsideCryptoScore", "culturalStrengthScore", "attentionScore", "narrative", "keyFinding", "bearCase"],
      },
    },
  },
  required: ["results"],
} as const;

export function deepdivePrompt(coins: Array<{ mint: string; symbol?: string; note?: string }>): string {
  const list = coins
    .map((c, i) => `${i + 1}. $${c.symbol ?? c.mint.slice(0, 6)} — mint: ${c.mint}${c.note ? ` — ${c.note}` : ""}`)
    .join("\n");
  return `BATCH DEEP-DIVE — hard second opinion on ${coins.length} Solana meme coins WE ARE CURRENTLY EXPOSED TO (or watching closely). Review ALL of them in this one mission.

${list}

For EACH coin, independently and quickly:
1. RugCheck the mint (authorities, LP, holder concentration) — flag anything that changed.
2. Current chart state on DexScreener/GeckoTerminal: liquidity trend, volume two-way or one-way, did it already pump (are we exit liquidity)?
3. Search the ticker on X + check TG/Discord if linked: is attention GROWING or DYING right now? Real humans or bots? Are big influencers already on it (late) or mid-tier callers just picking it up (early)?
4. Verdict per coin: confirm (attention growing — thesis intact), caution (weakening), unsure (cannot establish), avoid (thesis dead / scam signals — exit).

Be ruthless and honest per coin — a false "confirm" costs money, a false "avoid" costs nothing. Your output is ADVISORY: the engine maps each verdict onto its research facet and re-scores through hard safety gates. Return EVERY coin in the structured output with its mint address copied EXACTLY.`;
}
