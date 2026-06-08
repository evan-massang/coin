import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), {
  readonly: true,
  fileMustExist: true,
});

type Row = {
  id: number;
  symbol: string | null;
  verdict: string;
  price_at_alert: number | null;
  price_5m: number | null;
  price_15m: number | null;
  price_1h: number | null;
  max_gain_pct: number | null;
};

// ---- Claim 1: resolved-signal universe, p5m==p15m==p1h frozen rate ----
// "resolved" = has at least the horizon samples being compared. Test a few definitions.
const all = db
  .prepare(
    `SELECT id, symbol, verdict, price_at_alert, price_5m, price_15m, price_1h, max_gain_pct
       FROM signals`,
  )
  .all() as Row[];

console.log(`total signals rows: ${all.length}`);

// Definition A: rows where all three present
const all3 = all.filter(
  (r) => r.price_5m != null && r.price_15m != null && r.price_1h != null,
);
const frozen3 = all3.filter(
  (r) => r.price_5m === r.price_15m && r.price_15m === r.price_1h,
);
console.log(
  `[all3 present] n=${all3.length}  p5m==p15m==p1h: ${frozen3.length} (${((frozen3.length / all3.length) * 100).toFixed(1)}%)`,
);

// Definition: "resolved signals" denominator the finding used (claims 3738 / 1982 = 53.0%)
// Try: rows with max_gain_pct not null (a resolution marker)
const resolved = all.filter((r) => r.max_gain_pct != null);
const frozenResolvedTriple = resolved.filter(
  (r) =>
    r.price_5m != null &&
    r.price_5m === r.price_15m &&
    r.price_15m === r.price_1h,
);
console.log(
  `[max_gain not null] n=${resolved.length}  p5m==p15m==p1h (all eq, nonnull): ${frozenResolvedTriple.length} (${((frozenResolvedTriple.length / resolved.length) * 100).toFixed(1)}%)`,
);

// The finding's exact denominator 3738 — find what filter yields ~3738
console.log(`\n-- denominator探索 --`);
console.log(`rows price_5m not null: ${all.filter((r) => r.price_5m != null).length}`);
console.log(`rows price_15m not null: ${all.filter((r) => r.price_15m != null).length}`);
console.log(`rows price_1h not null: ${all.filter((r) => r.price_1h != null).length}`);
console.log(`rows price_5m AND price_15m not null: ${all.filter((r) => r.price_5m != null && r.price_15m != null).length}`);

// ---- Claim 2: among rows with both p5m & p15m, identical fraction (claims 2991/3699 = 80.9%) ----
const both5_15 = all.filter((r) => r.price_5m != null && r.price_15m != null);
const id5_15 = both5_15.filter((r) => r.price_5m === r.price_15m);
console.log(
  `\n[both p5m & p15m] n=${both5_15.length}  identical p5m==p15m: ${id5_15.length} (${((id5_15.length / both5_15.length) * 100).toFixed(1)}%)`,
);

// ---- Claim 3: movers (max_gain>20) with identical p5m==p15m (claims 85/219 = 38.8%) ----
const movers = both5_15.filter((r) => (r.max_gain_pct ?? 0) > 20);
const moversId = movers.filter((r) => r.price_5m === r.price_15m);
console.log(
  `[movers max_gain>20, both p5m&p15m] n=${movers.length}  identical: ${moversId.length} (${((moversId.length / movers.length) * 100).toFixed(1)}%)`,
);

// ---- Claim 4: BUY path coverage (claims n=882; p5m 773=87.6%, p15m 706=80.0%, p1h 531=60.2%) ----
const buys = all.filter(
  (r) => r.verdict === "BUY_SMALL" || r.verdict === "BUY_STRONG",
);
console.log(`\n[BUY universe] n=${buys.length}`);
console.log(`  price_5m present: ${buys.filter((r) => r.price_5m != null).length} (${((buys.filter((r) => r.price_5m != null).length / buys.length) * 100).toFixed(1)}%)`);
console.log(`  price_15m present: ${buys.filter((r) => r.price_15m != null).length} (${((buys.filter((r) => r.price_15m != null).length / buys.length) * 100).toFixed(1)}%)`);
console.log(`  price_1h present: ${buys.filter((r) => r.price_1h != null).length} (${((buys.filter((r) => r.price_1h != null).length / buys.length) * 100).toFixed(1)}%)`);

// ---- Sample row PANTHER ----
const panther = all.filter((r) => r.symbol === "PANTHER").slice(0, 3);
for (const p of panther) {
  console.log(
    `PANTHER id=${p.id} entry=${p.price_at_alert} 5m=${p.price_5m} 15m=${p.price_15m} 1h=${p.price_1h} maxGain=${p.max_gain_pct}`,
  );
}

db.close();
