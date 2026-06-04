// §Phase 5 token fingerprinting. Rugs are often relaunched with the same
// name/symbol/links. A deterministic fingerprint lets us recognise a new token
// that echoes a past rug and slash its risk multiplier. Pure.

export interface TokenFingerprintInput {
  name?: string;
  symbol?: string;
  uri?: string;
}

export interface Fingerprint {
  hash: string;
  normName: string;
  symbol: string;
  uriDomain: string;
}

export function normalizeName(name?: string): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function domainOf(uri?: string): string {
  if (!uri) return "";
  const m = uri.match(/^[a-z]+:\/\/([^/]+)/i);
  return (m?.[1] ?? "").toLowerCase();
}

// djb2 string hash → hex. Deterministic, no crypto dep.
function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

export function fingerprintToken(t: TokenFingerprintInput): Fingerprint {
  const normName = normalizeName(t.name);
  const symbol = (t.symbol ?? "").toLowerCase();
  const uriDomain = domainOf(t.uri);
  return { hash: hashStr(`${normName}|${symbol}|${uriDomain}`), normName, symbol, uriDomain };
}

export interface SimilarityResult {
  similar: boolean;
  match?: string;
  multiplier: number;
}

/**
 * Compare a token against known past rugs. An exact fingerprint hash match, or a
 * shared non-trivial normalized name, flags it as a likely rug relaunch.
 */
export function isSimilarToRug(t: TokenFingerprintInput, pastRugs: Fingerprint[]): SimilarityResult {
  const fp = fingerprintToken(t);
  for (const rug of pastRugs) {
    if (rug.hash === fp.hash) return { similar: true, match: rug.normName || rug.symbol, multiplier: 0.2 };
    if (fp.normName.length >= 3 && rug.normName === fp.normName) {
      return { similar: true, match: rug.normName, multiplier: 0.25 };
    }
  }
  return { similar: false, multiplier: 1 };
}
