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

/** A live candidate from the engine's own real-time feeds, seeded into the hunt. */
export interface DiscoverySeed {
  mint: string;
  symbol?: string;
  note?: string;
}

/** The operator's hunting prompt — VERBATIM. The first operationalized rewrite
 *  made Manus act like an engineer (it asked for APIs and offered "options"
 *  instead of hunting); the operator's own street-voice text makes it actually
 *  go to the websites and pick coins. Only additions: the candidate count, a
 *  casual postscript with our live seeds, and one line about filling the
 *  structured output. Do NOT "improve" the voice of this prompt. */
export function discoveryPrompt(candidateCount: number, seeds: DiscoverySeed[] = []): string {
  const seedBlock = seeds.length
    ? `

One more thing — our local scanner watches pump.fun and DexScreener in real time and just flagged these fresh ones minutes ago (public sites might not show them yet). Check these first, same rules, skip them freely if they fail anything:
${seeds.map((s, i) => `${i + 1}. ${s.symbol ? `$${s.symbol}` : "(no ticker)"} — ${s.mint}${s.note ? ` (${s.note})` : ""}`).join("\n")}
`
    : "";
  return `Go to DexScreener, filter Solana, sort by new pairs. Or use Pump.fun and look at the 'about to graduate' section — those already survived the worst rug phase. Photon or BullX are better if you wanna get serious, but DexScreener works.
Before you even consider a coin, it has to pass this:
Paste the contract into RugCheck.xyz. Mint authority revoked, freeze authority revoked, LP burned or locked. If any of those three fail, skip it, doesn't matter how good it looks. Top 10 holders under 25-30% combined (not counting the LP pool). No single wallet holding over 5%. No bundled supply flag. If RugCheck shows red or yellow, move on — there's a thousand other coins.
Liquidity and chart check on DexScreener:
At least $30-50k liquidity, minimum. Real two-way volume, not just buys. Holder count growing steadily, not flat. Chart should have actual structure, not a vertical candle that already did 10x — if it already pumped, we're exit liquidity.
Now the stuff that tells you if it'll actually moon:
Search the ticker on X. I need to see real humans posting, different writing styles, organic memes people made themselves — not 50 bot accounts posting the same image with the same caption. That's paid shilling and it dies in hours.
Check if there's a Telegram or Discord. Open it. Is it actual people chatting or just 'wen moon' spam and bots? Dead chat = dead coin.
The meme itself has to actually hit. Can you explain why it's funny or interesting in one sentence? Is it tied to something happening right now — a trend, an event, a character people know? Meme coins without a hook die in 72 hours. The ones that survive have an identity people wanna be part of.
Look for smaller Crypto Twitter accounts posting it before the big influencers. Once the big names tweet it, we're late — their followers are the exit liquidity. The edge is catching it when mid-tier callers with real track records are organically mentioning it.
Red flags, instant pass:
Anonymous team promising '100x guaranteed'
Identical shill posts across multiple accounts
Dev wallet selling on the chart
Liquidity shrinking
Chart already did a huge vertical move (we're too late)
Only hype is about price, no one's talking about the actual meme
When you find one, send me:
Contract address
Market cap and liquidity right now
RugCheck screenshot
Why you think the narrative works
Link to the X search for the ticker
Don't send me anything you wouldn't ape into yourself. And remember — we're looking for one with $50k-500k market cap with real traction building, not something that already pumped to $10M. If it's already trending on CT, we missed it. Just give me the top ${candidateCount} that really have a high chance they're gonna blow up, give me the coin address too.${seedBlock}
Fill in the structured output for every pick — exact contract address and all the fields (use 0 for a number you couldn't verify).`;
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
