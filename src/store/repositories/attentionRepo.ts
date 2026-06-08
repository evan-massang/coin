import type { DB } from "../db.js";
import type { AttentionRecord } from "../../attention/attentionService.js";
import type { AttentionEvidence } from "../../attention/types.js";

// Project Athena Phase 19 — durable attention research store ("meme graveyard").
// Latest snapshot per mint (upserted), so research survives restarts, warms the
// in-memory cache on boot, and is historically inspectable. Evidence is trimmed
// before persisting so the table stays small.

interface Row {
  mint: string;
  symbol: string | null;
  name: string | null;
  at: number;
  source: string;
  attention: number;
  humanity: number;
  virality: number;
  outside_crypto: number;
  cultural: number;
  confidence: number;
  narrative: string | null;
  posts_count: number | null;
  platforms: string | null;
  evidence_json: string | null;
}

function rowToRecord(r: Row): AttentionRecord {
  let evidence: AttentionEvidence;
  try {
    evidence = JSON.parse(r.evidence_json ?? "") as AttentionEvidence;
  } catch {
    evidence = { mint: r.mint, symbol: r.symbol ?? undefined, name: r.name ?? undefined, query: "", posts: [], platforms: (r.platforms ?? "").split(",").filter(Boolean), links: [], fetchedAt: r.at };
  }
  return {
    mint: r.mint,
    at: r.at,
    source: r.source === "llm" ? "llm" : "heuristic",
    scores: {
      humanity: r.humanity,
      virality: r.virality,
      outsideCrypto: r.outside_crypto,
      culturalStrength: r.cultural,
      attention: r.attention,
      confidence: r.confidence,
      tags: [],
      narrative: r.narrative ?? "",
      reasons: [],
    },
    evidence,
  };
}

export class AttentionRepo {
  constructor(private readonly db: DB) {}

  upsert(rec: AttentionRecord): void {
    const ev = rec.evidence;
    const trimmed: AttentionEvidence = { ...ev, posts: ev.posts.slice(0, 25) };
    this.db
      .prepare(
        `INSERT INTO attention_research(mint,symbol,name,at,source,attention,humanity,virality,outside_crypto,cultural,confidence,narrative,posts_count,platforms,evidence_json)
         VALUES (@mint,@symbol,@name,@at,@source,@attention,@humanity,@virality,@outside_crypto,@cultural,@confidence,@narrative,@posts_count,@platforms,@evidence_json)
         ON CONFLICT(mint) DO UPDATE SET symbol=excluded.symbol, name=excluded.name, at=excluded.at, source=excluded.source,
           attention=excluded.attention, humanity=excluded.humanity, virality=excluded.virality, outside_crypto=excluded.outside_crypto,
           cultural=excluded.cultural, confidence=excluded.confidence, narrative=excluded.narrative, posts_count=excluded.posts_count,
           platforms=excluded.platforms, evidence_json=excluded.evidence_json`,
      )
      .run({
        mint: rec.mint,
        symbol: ev.symbol ?? null,
        name: ev.name ?? null,
        at: rec.at,
        source: rec.source,
        attention: rec.scores.attention,
        humanity: rec.scores.humanity,
        virality: rec.scores.virality,
        outside_crypto: rec.scores.outsideCrypto,
        cultural: rec.scores.culturalStrength,
        confidence: rec.scores.confidence,
        narrative: rec.scores.narrative ?? null,
        posts_count: ev.posts.length,
        platforms: ev.platforms.join(",") || null,
        evidence_json: JSON.stringify(trimmed),
      });
  }

  recent(limit = 200): AttentionRecord[] {
    const rows = this.db.prepare("SELECT * FROM attention_research ORDER BY at DESC LIMIT ?").all(limit) as Row[];
    return rows.map(rowToRecord);
  }

  get(mint: string): AttentionRecord | undefined {
    const r = this.db.prepare("SELECT * FROM attention_research WHERE mint=?").get(mint) as Row | undefined;
    return r ? rowToRecord(r) : undefined;
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM attention_research").get() as { n: number }).n;
  }
}
