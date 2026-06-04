// Optional social-momentum source (LunarCrush). Requires a key; brand-new pump
// tokens usually aren't indexed yet, so the pipeline falls back to a
// narrative-derived heuristic when this returns undefined. Best-effort.

export interface SocialResult {
  score: number;
  reasons: string[];
}

export async function fetchSocialScore(symbol: string, apiKey: string, timeoutMs = 5000): Promise<SocialResult | undefined> {
  if (!apiKey || !symbol) return undefined;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://lunarcrush.com/api4/public/coins/${encodeURIComponent(symbol)}/v1`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { data?: { galaxy_score?: number; social_dominance?: number } };
    const galaxy = json.data?.galaxy_score;
    if (typeof galaxy !== "number") return undefined;
    return { score: Math.max(0, Math.min(100, Math.round(galaxy))), reasons: [`LunarCrush galaxy score ${galaxy}`] };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Narrative-derived social proxy when no live social data exists. */
export function heuristicSocial(tags: string[], isRevival: boolean): SocialResult {
  const score = Math.max(0, Math.min(100, 45 + tags.length * 5 + (isRevival ? 12 : 0)));
  const reasons = tags.length || isRevival ? [`narrative interest (${tags.join(", ") || "revival"})`] : ["no social data"];
  return { score, reasons };
}
