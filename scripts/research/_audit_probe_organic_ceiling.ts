/**
 * READ-ONLY adversarial verification of the "organic facet is monotonically
 * inverse to forward return; no organic ceiling" finding.
 *   npx tsx scripts/research/_audit_probe_organic_ceiling.ts
 */
import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), {
  readonly: true,
  fileMustExist: true,
});

type Row = {
  id: number;
  verdict: string;
  scores: string | null;
  price_at_alert: number | null;
  price_5m: number | null;
  max_gain_pct: number | null;
};

function organicOf(s: string | null): number | null {
  if (!s) return null;
  try {
    const j = JSON.parse(s);
    return typeof j.organic === "number" ? j.organic : null;
  } catch {
    return null;
  }
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function summarize(label: string, rows: { fwd5: number; win2x: boolean; maxg: number }[]) {
  const n = rows.length;
  if (!n) {
    console.log(`${label}: n=0`);
    return;
  }
  const fwd = rows.map((r) => r.fwd5);
  const red = rows.filter((r) => r.fwd5 < 0).length;
  const win = rows.filter((r) => r.win2x).length;
  console.log(
    `${label}: n=${n} meanFwd5m=${(mean(fwd) * 100).toFixed(1)}% red%=${((red / n) * 100).toFixed(0)} win2x=${((win / n) * 100).toFixed(1)}% meanMaxGain=${mean(rows.map((r) => r.maxg)).toFixed(1)}%`,
  );
}

// ---- Universe A: TRADED BUYs with price_5m + max_gain resolved ----
const buys = (
  db
    .prepare(
      `SELECT id, verdict, scores, price_at_alert, price_5m, max_gain_pct
         FROM signals
        WHERE verdict IN ('BUY_SMALL','BUY_STRONG')
          AND price_at_alert IS NOT NULL AND price_at_alert > 0
          AND price_5m IS NOT NULL
          AND max_gain_pct IS NOT NULL`,
    )
    .all() as Row[]
)
  .map((r) => {
    const org = organicOf(r.scores);
    if (org == null) return null;
    const fwd5 = (r.price_5m! - r.price_at_alert!) / r.price_at_alert!;
    return { org, fwd5, win2x: (r.max_gain_pct ?? 0) >= 100, maxg: r.max_gain_pct ?? 0 };
  })
  .filter((x): x is NonNullable<typeof x> => x != null);

console.log(`\n=== TRADED BUYs (price_5m & max_gain present, organic parsed): n=${buys.length} ===`);

const buckets: [string, (o: number) => boolean][] = [
  ["organic 30-49", (o) => o >= 30 && o < 50],
  ["organic 50-69", (o) => o >= 50 && o < 70],
  ["organic 70-84", (o) => o >= 70 && o < 85],
  ["organic >=85 ", (o) => o >= 85],
];
for (const [lab, pred] of buckets) summarize(lab, buys.filter((b) => pred(b.org)));

// ---- Filter simulations ----
console.log(`\n=== FILTER SIMS (traded BUYs) ===`);
summarize("ALL traded BUYs    ", buys);
summarize("organic<70 only    ", buys.filter((b) => b.org < 70));
summarize("organic<85 only    ", buys.filter((b) => b.org < 85));
summarize("organic>=85 DROPPED ", buys.filter((b) => b.org >= 85));
summarize("organic 50-80      ", buys.filter((b) => b.org >= 50 && b.org <= 80));

// ---- Correlation organic vs fwd5m on traded BUYs ----
function corr(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    dx += (xs[i]! - mx) ** 2;
    dy += (ys[i]! - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}
console.log(`\ncorr(organic, fwd5m) on traded BUYs = ${corr(buys.map((b) => b.org), buys.map((b) => b.fwd5)).toFixed(3)}`);

// ---- Distribution of organic among traded BUYs (how many would the ceiling clip?) ----
const ge85 = buys.filter((b) => b.org >= 85).length;
const ge80 = buys.filter((b) => b.org >= 80).length;
const ge70 = buys.filter((b) => b.org >= 70).length;
console.log(`\nClip counts among traded BUYs: organic>=70 ${ge70} (${((ge70 / buys.length) * 100).toFixed(0)}%), >=80 ${ge80} (${((ge80 / buys.length) * 100).toFixed(0)}%), >=85 ${ge85} (${((ge85 / buys.length) * 100).toFixed(0)}%)`);

// ---- Winners lost vs losers removed if we cap >=85 ----
const dropped85 = buys.filter((b) => b.org >= 85);
const winnersDropped = dropped85.filter((b) => b.win2x).length;
console.log(`Cap>=85 would clip ${dropped85.length} BUYs: ${winnersDropped} were 2x winners, ${dropped85.length - winnersDropped} were not.`);

db.close();
