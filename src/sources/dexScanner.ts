import type { NewToken } from "../types.js";
import { SeenCache } from "../util/seenCache.js";
import { log } from "../util/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// "Maturing-survivor" discovery (Cycle 8 — the operator's "Golden Filter"). The
// engine's other source (PumpPortal newborns) is blind+late on seconds-old coins;
// this one SCANS DexScreener for coins that already graduated to a real Raydium
// pool — old enough that price/liquidity/RugCheck data is RELIABLE, young enough
// to still run. Free endpoints, no key:
//   token-boosts / token-profiles  → tokens paying for visibility (candidate set)
//   /latest/dex/tokens/{mints}     → MC / liquidity / volume / pair age to filter
// Emits NewToken{discoverySource:"scan"} into the SAME observe→score pipeline.
// ─────────────────────────────────────────────────────────────────────────────

const BOOSTS = "https://api.dexscreener.com/token-boosts/latest/v1";
const PROFILES = "https://api.dexscreener.com/token-profiles/latest/v1";
const TOKENS = "https://api.dexscreener.com/latest/dex/tokens/";
const GECKO = "https://api.geckoterminal.com/api/v2";

export interface GoldenFilter {
  minMcapUsd: number; // e.g. 50_000
  maxMcapUsd: number; // e.g. 200_000
  minLiqUsd: number; // e.g. 30_000
  minVolMcRatio: number; // 24h volume / marketcap, e.g. 2.0
  maxAgeHours: number; // pair age, e.g. 6
}

/** The maturity stats we extract from a DexScreener pair to filter on. */
export interface PairStats {
  mint: string;
  name?: string;
  symbol?: string;
  mcapUsd?: number;
  liqUsd?: number;
  vol24Usd?: number;
  ageMs?: number; // now − pairCreatedAt
}

interface RawPair {
  chainId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  volume?: { h24?: number };
  pairCreatedAt?: number;
}

/** PURE: does a pair clear the Golden Filter? Unknown required fields ⇒ reject. */
export function passesGoldenFilter(s: PairStats, f: GoldenFilter, now: number): boolean {
  if (s.mcapUsd == null || s.liqUsd == null || s.vol24Usd == null || s.ageMs == null) return false;
  if (s.mcapUsd < f.minMcapUsd || s.mcapUsd > f.maxMcapUsd) return false;
  if (s.liqUsd < f.minLiqUsd) return false;
  if (s.mcapUsd > 0 && s.vol24Usd / s.mcapUsd < f.minVolMcRatio) return false;
  if (s.ageMs > f.maxAgeHours * 3_600_000) return false;
  void now;
  return true;
}

/** PURE: pick the most-liquid Solana pair per mint and extract its maturity stats. */
export function statsFromPairs(pairs: RawPair[], now: number): Map<string, PairStats> {
  const out = new Map<string, PairStats>();
  for (const p of pairs) {
    if (p.chainId !== "solana") continue;
    const mint = p.baseToken?.address;
    if (!mint) continue;
    const liq = p.liquidity?.usd;
    const prev = out.get(mint);
    // keep the most-liquid pair for this mint
    if (prev && (prev.liqUsd ?? 0) >= (liq ?? 0)) continue;
    out.set(mint, {
      mint,
      name: p.baseToken?.name,
      symbol: p.baseToken?.symbol,
      mcapUsd: p.marketCap ?? p.fdv,
      liqUsd: liq,
      vol24Usd: p.volume?.h24,
      ageMs: p.pairCreatedAt ? now - p.pairCreatedAt : undefined,
    });
  }
  return out;
}

/** A GeckoTerminal pool object (only the fields we read). */
export interface GeckoPool {
  attributes?: {
    name?: string;
    market_cap_usd?: string | null;
    fdv_usd?: string | null;
    reserve_in_usd?: string | null; // total liquidity
    volume_usd?: { h24?: string };
    pool_created_at?: string; // ISO8601
  };
  relationships?: { base_token?: { data?: { id?: string } } }; // id = "solana_<mint>"
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** PURE: GeckoTerminal pools → maturity stats (most-liquid pool per mint). */
export function statsFromGeckoPools(pools: GeckoPool[], now: number): Map<string, PairStats> {
  const out = new Map<string, PairStats>();
  for (const p of pools) {
    const id = p.relationships?.base_token?.data?.id;
    if (!id || !id.startsWith("solana_")) continue;
    const mint = id.slice("solana_".length);
    const a = p.attributes ?? {};
    const liq = num(a.reserve_in_usd);
    const prev = out.get(mint);
    if (prev && (prev.liqUsd ?? 0) >= (liq ?? 0)) continue;
    const created = a.pool_created_at ? Date.parse(a.pool_created_at) : NaN;
    out.set(mint, {
      mint,
      name: a.name,
      symbol: a.name ? a.name.split("/")[0]?.trim() : undefined, // "three / SOL" → "three"
      mcapUsd: num(a.market_cap_usd) ?? num(a.fdv_usd),
      liqUsd: liq,
      vol24Usd: num(a.volume_usd?.h24),
      ageMs: Number.isFinite(created) ? now - created : undefined,
    });
  }
  return out;
}

type Handler = (t: NewToken) => void;

export class DexScanner {
  private handler?: Handler;
  private timer?: NodeJS.Timeout;
  private readonly seen = new SeenCache(6 * 60 * 60_000); // don't re-emit a mint within 6h
  private polling = false;

  constructor(
    private readonly filter: () => GoldenFilter,
    private readonly intervalMs = 120_000,
  ) {}

  on(handler: Handler): this {
    this.handler = handler;
    return this;
  }

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    log.ok("dex scanner started (maturing-survivor Golden Filter)");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One scan pass: two free candidate sources → Golden Filter → emit. */
  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const now = Date.now();
      const f = this.filter();
      const stats = new Map<string, PairStats>();
      // PRIMARY: GeckoTerminal recently-created + trending Solana pools — these
      // come WITH mcap/liquidity/volume/age, so they directly surface the
      // graduated "maturing survivor" population the Golden Filter wants.
      for (const s of await this.fetchGeckoStats(now)) if (!stats.has(s.mint)) stats.set(s.mint, s);
      // SECONDARY: DexScreener boosted/profiled (tokens paying for visibility).
      for (const s of await this.fetchBoostStats(now)) if (!stats.has(s.mint)) stats.set(s.mint, s);

      let emitted = 0;
      for (const s of stats.values()) {
        if (this.seen.has(s.mint)) continue;
        if (!passesGoldenFilter(s, f, now)) continue;
        this.seen.add(s.mint);
        this.handler?.({ mint: s.mint, name: s.name, symbol: s.symbol, seenAt: now, discoverySource: "scan" });
        emitted++;
      }
      if (emitted > 0) log.info(`dex scanner: ${emitted} Golden-Filter candidate(s) from ${stats.size} scanned`);
    } catch (e) {
      log.warn(`dex scanner poll failed: ${(e as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  /** GeckoTerminal new + trending Solana pools (free, keyless) → maturity stats. */
  private async fetchGeckoStats(now: number): Promise<PairStats[]> {
    const urls = [
      `${GECKO}/networks/solana/new_pools?page=1`,
      `${GECKO}/networks/solana/new_pools?page=2`,
      `${GECKO}/networks/solana/trending_pools?page=1`,
    ];
    const out: PairStats[] = [];
    for (const u of urls) {
      try {
        const r = await fetch(u, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const j = (await r.json()) as { data?: GeckoPool[] };
        for (const s of statsFromGeckoPools(j.data ?? [], now).values()) out.push(s);
      } catch {
        /* best-effort; next poll retries */
      }
    }
    return out;
  }

  /** DexScreener boosted/profiled Solana mints → /tokens batch → maturity stats. */
  private async fetchBoostStats(now: number): Promise<PairStats[]> {
    const set = new Set<string>();
    for (const url of [BOOSTS, PROFILES]) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const arr = (await res.json()) as Array<{ chainId?: string; tokenAddress?: string }>;
        for (const it of Array.isArray(arr) ? arr : []) if (it.chainId === "solana" && it.tokenAddress) set.add(it.tokenAddress);
      } catch {
        /* best-effort */
      }
    }
    const mints = [...set];
    const out: PairStats[] = [];
    for (let i = 0; i < mints.length; i += 30) {
      try {
        const res = await fetch(TOKENS + mints.slice(i, i + 30).join(","), { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const json = (await res.json()) as { pairs?: RawPair[] };
        for (const s of statsFromPairs(json.pairs ?? [], now).values()) out.push(s);
      } catch {
        /* best-effort */
      }
    }
    return out;
  }
}
