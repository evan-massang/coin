import Database from "better-sqlite3";
import path from "node:path";

const DB = path.resolve("data/sniper.sqlite");
const db = new Database(DB, { readonly: true, fileMustExist: true });

const WIN = 100; // max_gain_pct >= 100 == 2x
const TRADED = "verdict IN ('BUY_SMALL','BUY_STRONG')";

function pct(n: number, d: number) {
  return d ? ((100 * n) / d).toFixed(1) + "%" : "n/a";
}
function fmt(x: number | null | undefined, dp = 1) {
  return x === null || x === undefined ? "n/a" : x.toFixed(dp);
}

// ── Schema sanity ──────────────────────────────────────────────────────────
const sigCols = (db.prepare("PRAGMA table_info(signals)").all() as any[]).map((c) => c.name);
const coCols = (db.prepare("PRAGMA table_info(council_opinions)").all() as any[]).map((c) => c.name);
console.log("signals cols incl conviction?", sigCols.includes("conviction"), "max_gain_pct?", sigCols.includes("max_gain_pct"));
console.log("council_opinions cols:", coCols.join(", "));

// resolved = has an outcome we can score. We treat a signal as resolved if max_gain_pct IS NOT NULL.
const resolvedTraded = db.prepare(`SELECT COUNT(*) n FROM signals WHERE ${TRADED} AND max_gain_pct IS NOT NULL`).get() as any;
const resolvedAll = db.prepare(`SELECT COUNT(*) n FROM signals WHERE max_gain_pct IS NOT NULL`).get() as any;
console.log(`\nresolved signals (max_gain_pct not null): all=${resolvedAll.n}  traded=${resolvedTraded.n}`);

// ── (1) CALIBRATION ─────────────────────────────────────────────────────────
// Bucket resolved signals by conviction; report win-rate(>=2x) and mean/median max_gain.
console.log("\n=========================================================");
console.log("(1) CALIBRATION by conviction bucket");
console.log("=========================================================");

function calibByConviction(filterSql: string, label: string) {
  console.log(`\n--- ${label} ---`);
  const rows = db
    .prepare(
      `SELECT conviction, max_gain_pct AS g
         FROM signals
        WHERE max_gain_pct IS NOT NULL AND conviction IS NOT NULL ${filterSql ? "AND " + filterSql : ""}`,
    )
    .all() as { conviction: number; g: number }[];

  const buckets: { name: string; test: (c: number) => boolean }[] = [
    { name: "<50", test: (c) => c < 50 },
    { name: "50-58", test: (c) => c >= 50 && c < 59 },
    { name: "59 (the cap)", test: (c) => c === 59 },
    { name: "60-71", test: (c) => c >= 60 && c < 72 },
    { name: "72+ (BUY_STRONG gate)", test: (c) => c >= 72 },
  ];

  console.log("bucket".padEnd(22), "n".padStart(6), "winrate>=2x".padStart(13), "meanGain%".padStart(11), "medGain%".padStart(10));
  for (const b of buckets) {
    const xs = rows.filter((r) => b.test(r.conviction));
    if (!xs.length) {
      console.log(b.name.padEnd(22), "0".padStart(6), "n/a".padStart(13), "n/a".padStart(11), "n/a".padStart(10));
      continue;
    }
    const wins = xs.filter((r) => r.g >= WIN).length;
    const gains = xs.map((r) => r.g).sort((a, b2) => a - b2);
    const mean = gains.reduce((a, x) => a + x, 0) / gains.length;
    const med = gains[Math.floor(gains.length / 2)]!;
    console.log(
      b.name.padEnd(22),
      String(xs.length).padStart(6),
      pct(wins, xs.length).padStart(13),
      fmt(mean).padStart(11),
      fmt(med).padStart(10),
    );
  }
}

calibByConviction("", "ALL resolved signals (any verdict)");
calibByConviction(TRADED, "TRADED only (BUY_SMALL/BUY_STRONG)");

// Distinct conviction values among traded (to confirm the "everything is 59" claim)
const convDist = db
  .prepare(`SELECT conviction, COUNT(*) n, SUM(CASE WHEN max_gain_pct>=${WIN} THEN 1 ELSE 0 END) wins, SUM(CASE WHEN max_gain_pct IS NOT NULL THEN 1 ELSE 0 END) resolved FROM signals WHERE ${TRADED} GROUP BY conviction ORDER BY conviction`)
  .all() as any[];
console.log("\nTraded conviction distribution (raw):");
for (const r of convDist) console.log(`  conv=${r.conviction}  n=${r.n}  resolved=${r.resolved}  wins(>=2x)=${r.wins}  winrate=${pct(r.wins, r.resolved)}`);

// ── (2) COUNCIL NOVELTY ──────────────────────────────────────────────────────
console.log("\n=========================================================");
console.log("(2) COUNCIL NOVELTY — does council add info beyond verdict?");
console.log("=========================================================");

const coTotal = db.prepare("SELECT COUNT(*) n FROM council_opinions").get() as any;
console.log("council_opinions rows total:", coTotal.n);
const coRecDist = db.prepare("SELECT recommendation, COUNT(*) n FROM council_opinions GROUP BY recommendation").all();
console.log("per-seat recommendation distribution:", JSON.stringify(coRecDist));
const distinctMints = db.prepare("SELECT COUNT(DISTINCT mint) n FROM council_opinions").get() as any;
console.log("distinct mints with council opinions:", distinctMints.n);

// Per-mint council consensus: majority direction of seats. Join to signals for verdict + outcome.
// One signal row per mint may not hold; pick the signal with max_gain_pct for that mint (latest decision w/ outcome).
const perMint = db
  .prepare(
    `WITH co AS (
       SELECT mint,
              SUM(CASE WHEN recommendation='confirm' THEN 1 ELSE 0 END) AS confirms,
              SUM(CASE WHEN recommendation='caution' THEN 1 ELSE 0 END) AS cautions,
              COUNT(*) AS seats,
              AVG(score) AS avg_score
         FROM council_opinions
        GROUP BY mint
     ),
     sig AS (
       SELECT s.mint, s.verdict, s.conviction, s.max_gain_pct AS g,
              ROW_NUMBER() OVER (PARTITION BY s.mint ORDER BY (s.max_gain_pct IS NOT NULL) DESC, s.at DESC) rn
         FROM signals s
     )
     SELECT co.mint, co.confirms, co.cautions, co.seats, co.avg_score,
            sig.verdict, sig.conviction, sig.g
       FROM co JOIN sig ON sig.mint = co.mint AND sig.rn = 1`,
  )
  .all() as any[];

console.log(`\nmints with council + matched signal: ${perMint.length}`);
const withOutcome = perMint.filter((r) => r.g !== null && r.g !== undefined);
console.log(`  of those, with resolved outcome (max_gain_pct not null): ${withOutcome.length}`);

function councilDir(r: any): "confirm" | "caution" | "tie" {
  if (r.confirms > r.cautions) return "confirm";
  if (r.cautions > r.confirms) return "caution";
  return "tie";
}

function novelty(rows: any[], label: string) {
  console.log(`\n--- ${label} (n with outcome=${rows.length}) ---`);
  const groups: Record<string, any[]> = { confirm: [], caution: [], tie: [] };
  for (const r of rows) groups[councilDir(r)]!.push(r);
  console.log("councilDir".padEnd(12), "n".padStart(6), "winrate>=2x".padStart(13), "meanGain%".padStart(11), "medGain%".padStart(10));
  for (const k of ["confirm", "caution", "tie"]) {
    const xs = groups[k]!;
    if (!xs.length) {
      console.log(k.padEnd(12), "0".padStart(6), "n/a".padStart(13), "n/a".padStart(11), "n/a".padStart(10));
      continue;
    }
    const wins = xs.filter((r) => r.g >= WIN).length;
    const gains = xs.map((r) => r.g).sort((a: number, b: number) => a - b);
    const mean = gains.reduce((a: number, x: number) => a + x, 0) / gains.length;
    const med = gains[Math.floor(gains.length / 2)]!;
    console.log(k.padEnd(12), String(xs.length).padStart(6), pct(wins, xs.length).padStart(13), fmt(mean).padStart(11), fmt(med).padStart(10));
  }
}

// Among ENGINE BUYs specifically (the key novelty question)
const buysWithOutcome = withOutcome.filter((r) => r.verdict === "BUY_SMALL" || r.verdict === "BUY_STRONG");
novelty(withOutcome, "ALL council-reviewed mints");
novelty(buysWithOutcome, "ENGINE BUYs only — does council split winners from losers?");

// Also bucket by council avg_score continuous, among BUYs
if (buysWithOutcome.length) {
  console.log("\n--- ENGINE BUYs: council avg_score bands ---");
  const bands = [
    { name: "<45", lo: -1, hi: 45 },
    { name: "45-54", lo: 45, hi: 55 },
    { name: "55-64", lo: 55, hi: 65 },
    { name: ">=65", lo: 65, hi: 1e9 },
  ];
  console.log("scoreBand".padEnd(12), "n".padStart(6), "winrate>=2x".padStart(13), "meanGain%".padStart(11));
  for (const b of bands) {
    const xs = buysWithOutcome.filter((r) => r.avg_score >= b.lo && r.avg_score < b.hi);
    if (!xs.length) {
      console.log(b.name.padEnd(12), "0".padStart(6), "n/a".padStart(13), "n/a".padStart(11));
      continue;
    }
    const wins = xs.filter((r) => r.g >= WIN).length;
    const mean = xs.reduce((a, r) => a + r.g, 0) / xs.length;
    console.log(b.name.padEnd(12), String(xs.length).padStart(6), pct(wins, xs.length).padStart(13), fmt(mean).padStart(11));
  }
}

// Cross-check using the stored per-opinion outcome ('win'/'loss') if populated
const outcomeResolved = db.prepare("SELECT COUNT(*) n FROM council_opinions WHERE outcome IS NOT NULL").get() as any;
console.log(`\ncouncil_opinions with stored outcome populated: ${outcomeResolved.n}`);
if (outcomeResolved.n > 0) {
  const acc = db
    .prepare(
      `SELECT recommendation,
              SUM(CASE WHEN outcome='win' THEN 1 ELSE 0 END) wins,
              SUM(CASE WHEN outcome='loss' THEN 1 ELSE 0 END) losses,
              COUNT(*) n
         FROM council_opinions WHERE outcome IS NOT NULL GROUP BY recommendation`,
    )
    .all() as any[];
  console.log("per-seat stored-outcome by recommendation:");
  for (const r of acc) console.log(`  ${r.recommendation}: n=${r.n} wins=${r.wins} losses=${r.losses} winrate=${pct(r.wins, r.n)}`);
}

db.close();
