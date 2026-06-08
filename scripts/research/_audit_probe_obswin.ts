import Database from "better-sqlite3";
import path from "node:path";

const db = new Database(path.resolve("data/sniper.sqlite"), { readonly: true, fileMustExist: true });

function quantiles(arr: number[], qs: number[]): Record<string, number> {
  const a = [...arr].sort((x, y) => x - y);
  const out: Record<string, number> = {};
  for (const q of qs) {
    const idx = Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))));
    out[`p${Math.round(q * 100)}`] = a[idx];
  }
  return out;
}

const rows = db.prepare(`
  SELECT s.verdict AS verdict, s.at AS sat, t.first_seen_at AS fs, t.created_at AS ca
  FROM signals s JOIN tokens t ON s.mint = t.mint
  WHERE t.first_seen_at IS NOT NULL
`).all() as { verdict: string; sat: number; fs: number; ca: number | null }[];

console.log("total joined signals:", rows.length);

function norm(x: number): number { return x > 1e12 ? x : x * 1000; }
function latSec(r: { sat: number; fs: number }): number { return (norm(r.sat) - norm(r.fs)) / 1000; }

const byVerdict: Record<string, number[]> = {};
for (const r of rows) {
  const v = (r.verdict || "?").toUpperCase();
  const grp = v.startsWith("BUY") ? "BUY" : v.startsWith("WATCH") ? "WATCH" : v;
  (byVerdict[grp] ??= []).push(latSec(r));
}
for (const [v, arr] of Object.entries(byVerdict)) {
  const valid = arr.filter((x) => Number.isFinite(x) && x >= 0 && x < 3600);
  console.log(`LATENCY ${v} n=${valid.length}/${arr.length}`, quantiles(valid, [0.05, 0.25, 0.5, 0.75, 0.95]));
}

const tk = db.prepare(`SELECT created_at AS ca, first_seen_at AS fs FROM tokens WHERE first_seen_at IS NOT NULL`).all() as { ca: number | null; fs: number }[];
let leZero = 0, nullCa = 0, posGap = 0, total = 0;
const gaps: number[] = [];
for (const r of tk) {
  total++;
  if (r.ca == null) { nullCa++; continue; }
  const gap = (norm(r.fs) - norm(r.ca)) / 1000;
  gaps.push(gap);
  if (gap <= 0) leZero++; else posGap++;
}
console.log(`BORN->FIRSTSEEN total=${total} nullCreatedAt=${nullCa} gap<=0=${leZero} gap>0=${posGap}`);
if (gaps.length) console.log("gap(sec) quantiles:", quantiles(gaps, [0.5, 0.95, 0.99]));

const perMint = db.prepare(`SELECT mint, COUNT(*) AS c FROM signals GROUP BY mint`).all() as { mint: string; c: number }[];
const multi = perMint.filter((r) => r.c > 1);
console.log(`SIGNALS PER MINT: distinct mints=${perMint.length}, mints>1signal=${multi.length}, max=${Math.max(...perMint.map((r) => r.c))}`);

db.close();
