// RugCheck FULL report (https://api.rugcheck.xyz/v1/tokens/{mint}/report).
// KEYLESS by default — verified to return authorities + holders + LP-lock +
// risks + liquidity with no API key. A key only raises rate limits.
//
// `fetchRugcheck` does the network/JSON (never throws → undefined on any
// failure); `parseRugcheckReport` is PURE (unit-testable, no network).
// Lenient by design: only a honeypot sets highRisk. Holder-concentration and
// the noisy raw `graphInsidersDetected` count are NOT trusted here.

const ENDPOINT = "https://api.rugcheck.xyz/v1/tokens/";

export type RiskLevel = "low" | "medium" | "danger" | "unknown";

export interface RugcheckRisk {
  name: string;
  level: string;
  description?: string;
  score?: number;
}

export interface RugcheckReport {
  mintAuthorityRevoked?: boolean;
  freezeAuthorityNull?: boolean;
  /** Largest non-insider, non-pool (≤80%) holder %. undefined ⇒ unknown. */
  topHolderPct?: number;
  risks: RugcheckRisk[];
  riskLevel: RiskLevel;
  /** Genuinely cannot-sell / drain risk (the only hard-fail signal). */
  honeypot: boolean;
  highRisk: boolean;
  scoreNormalised?: number;
  totalLiquidityUsd?: number;
  lpLockedPct?: number;
  /** false only when a DANGER-level insider/bundle risk is curated by RugCheck. */
  insiderClean: boolean;
}

interface RugcheckRaw {
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  token?: { mintAuthority?: string | null; freezeAuthority?: string | null };
  rugged?: boolean;
  topHolders?: Array<{ pct?: number; insider?: boolean }>;
  risks?: Array<{ name?: string; level?: string; description?: string; score?: number; value?: string }>;
  score_normalised?: number;
  totalMarketLiquidity?: number;
  transferFee?: { pct?: number };
  markets?: Array<{ lp?: { lpLockedPct?: number; lpLockedUSD?: number; quoteUSD?: number; baseUSD?: number } }>;
}

export async function fetchRugcheck(
  mint: string,
  apiKey?: string,
  timeoutMs = 6000,
): Promise<RugcheckReport | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${ENDPOINT}${mint}/report`, { headers, signal: ctrl.signal });
    if (!res.ok) return undefined;
    const raw = (await res.json()) as RugcheckRaw;
    return parseRugcheckReport(raw);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export function parseRugcheckReport(raw: RugcheckRaw): RugcheckReport {
  const risks: RugcheckRisk[] = (raw.risks ?? [])
    .filter((r): r is NonNullable<typeof r> => !!r && typeof r.name === "string")
    .map((r) => ({ name: r.name!, level: r.level ?? "", description: r.description, score: r.score }));

  const hasBody =
    !!raw.token ||
    Array.isArray(raw.topHolders) ||
    Array.isArray(raw.risks) ||
    Array.isArray(raw.markets) ||
    raw.mintAuthority !== undefined;

  const hasDanger = risks.some((r) => /danger/i.test(r.level));
  const hasWarn = risks.some((r) => /warn/i.test(r.level));
  const riskLevel: RiskLevel = !hasBody ? "unknown" : hasDanger ? "danger" : hasWarn ? "medium" : "low";

  const dangerText = (r: RugcheckRisk) => `${r.name} ${r.description ?? ""}`;
  const honeypot =
    raw.rugged === true ||
    risks.some((r) => /danger/i.test(r.level) && /honeypot|cannot sell|can.?t sell|transfer.?fee|frozen|freeze/i.test(dangerText(r))) ||
    (raw.transferFee?.pct ?? 0) >= 50;

  const insiderClean = !risks.some((r) => /danger/i.test(r.level) && /insider|bundle/i.test(dangerText(r)));

  return {
    mintAuthorityRevoked: authRevoked(raw.mintAuthority, raw.token?.mintAuthority),
    freezeAuthorityNull: authRevoked(raw.freezeAuthority, raw.token?.freezeAuthority),
    topHolderPct: topNonPoolHolderPct(raw.topHolders),
    risks,
    riskLevel,
    honeypot,
    highRisk: honeypot,
    scoreNormalised: typeof raw.score_normalised === "number" ? raw.score_normalised : undefined,
    totalLiquidityUsd: raw.totalMarketLiquidity ?? sumMarketLiquidity(raw.markets),
    lpLockedPct: maxLpLockedPct(raw.markets),
    insiderClean,
  };
}

/** true=revoked/null (safe). undefined only when neither field is present. */
function authRevoked(top: string | null | undefined, nested: string | null | undefined): boolean | undefined {
  if (top === undefined && nested === undefined) return undefined;
  return top == null && nested == null;
}

function topNonPoolHolderPct(holders?: Array<{ pct?: number; insider?: boolean }>): number | undefined {
  if (!Array.isArray(holders) || holders.length === 0) return undefined;
  const real = holders.filter(
    (h) => h && typeof h.pct === "number" && !h.insider && (h.pct as number) <= 80,
  );
  if (real.length === 0) return undefined;
  return Math.max(...real.map((h) => h.pct as number));
}

function maxLpLockedPct(markets?: RugcheckRaw["markets"]): number | undefined {
  const pcts = (markets ?? [])
    .map((m) => m.lp?.lpLockedPct)
    .filter((x): x is number => typeof x === "number");
  return pcts.length ? Math.max(...pcts) : undefined;
}

function sumMarketLiquidity(markets?: RugcheckRaw["markets"]): number | undefined {
  if (!Array.isArray(markets) || markets.length === 0) return undefined;
  let sum = 0;
  let any = false;
  for (const m of markets) {
    const lp = m.lp;
    if (!lp) continue;
    if (typeof lp.quoteUSD === "number" || typeof lp.baseUSD === "number") {
      sum += (lp.quoteUSD ?? 0) + (lp.baseUSD ?? 0);
      any = true;
    } else if (typeof lp.lpLockedUSD === "number") {
      sum += lp.lpLockedUSD;
      any = true;
    }
  }
  return any ? sum : undefined;
}
