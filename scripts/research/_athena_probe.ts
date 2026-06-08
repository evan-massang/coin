/** Live check: collect real web evidence for a meme + score attention.
 *   npx tsx scripts/research/_athena_probe.ts [name] [symbol] */
import { collectEvidence } from "../../src/attention/researchAgent.js";
import { computeAttention } from "../../src/attention/attentionAgent.js";

const name = process.argv[2] || "pepe";
const symbol = process.argv[3] || "PEPE";
console.log(`collecting evidence for "${name}" ($${symbol})…`);
const ev = await collectEvidence({ mint: "PROBE", name, symbol }, { headless: true, maxPerQuery: 6 });
console.log(`\nposts: ${ev.posts.length}  platforms: ${ev.platforms.join(", ") || "(none)"}`);
for (const p of ev.posts.slice(0, 10)) console.log(`  [${p.platform.padEnd(8)}] ${(p.author ? "@" + p.author + " " : "")}${p.text.slice(0, 90)}`);
const a = computeAttention(ev);
console.log(`\n${a.narrative}`);
console.log(`reasons: ${a.reasons.join(" | ")}`);
console.log(`tags: ${a.tags.join(", ") || "(none)"}`);
