import type { HypeToken } from "./heuristicScorer.js";

// Prompts for the optional Claude hype judge. The SYSTEM block is static so it
// can be prompt-cached across calls (cache_control: ephemeral in llmScorer).

export const HYPE_SYSTEM = `You judge the MEMETIC VIRALITY of brand-new Solana meme coins for a signal engine.

You are a narrative-confirmation layer ONLY. You do NOT assess safety, rug risk, or whether to buy —
that is handled by separate hard gates. Never tell the user to buy or sell.

Given a token's name, symbol, and any description, rate how memetically sticky / culturally resonant it
is right now: is the name funny, timely, riffing on a current narrative, or reviving a classic meme? Weak,
generic, or random-string names score low.

Respond with STRICT JSON only, no prose, in exactly this shape:
{"score": <0-100 integer>, "is_revival": <boolean>, "tags": [<short strings>], "rationale": "<one sentence>"}`;

export function buildHypeUserPrompt(token: HypeToken): string {
  const lines = [
    `Name: ${token.name ?? "(none)"}`,
    `Symbol: ${token.symbol ?? "(none)"}`,
  ];
  if (token.description) lines.push(`Description: ${token.description}`);
  lines.push("\nRate its memetic virality as strict JSON.");
  return lines.join("\n");
}
