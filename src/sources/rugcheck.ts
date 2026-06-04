// RugCheck public report (best-effort, optional key). Used as a secondary
// source for authorities + risk flags when RPC is unknown. Returns undefined on
// any failure so the safety gate degrades gracefully to UNKNOWN.

export interface RugcheckReport {
  mintAuthorityRevoked?: boolean;
  freezeAuthorityNull?: boolean;
  topHolderPct?: number;
  /** RugCheck's own normalized risk label, if present. */
  riskLevel?: string;
  /** True if RugCheck flags a high/danger risk. */
  highRisk?: boolean;
}

const ENDPOINT = "https://api.rugcheck.xyz/v1/tokens/";

interface RugcheckRaw {
  token?: { mintAuthority?: string | null; freezeAuthority?: string | null };
  topHolders?: Array<{ pct?: number }>;
  score?: number;
  risks?: Array<{ name?: string; level?: string }>;
}

export async function fetchRugcheck(mint: string, apiKey?: string, timeoutMs = 6000): Promise<RugcheckReport | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${ENDPOINT}${mint}/report/summary`, { headers, signal: ctrl.signal });
    if (!res.ok) return undefined;
    const raw = (await res.json()) as RugcheckRaw;
    const highRisk = (raw.risks ?? []).some((r) => /danger|high/i.test(r.level ?? ""));
    return {
      mintAuthorityRevoked: raw.token ? raw.token.mintAuthority == null : undefined,
      freezeAuthorityNull: raw.token ? raw.token.freezeAuthority == null : undefined,
      topHolderPct: raw.topHolders?.[0]?.pct,
      riskLevel: raw.risks?.[0]?.level,
      highRisk,
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
