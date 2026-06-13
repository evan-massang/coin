// Verify the live collector pulls posts from MULTIPLE sources with stealth flags
// (Bing/News/Reddit/Brave/DDG), through the real engine code path. Read-only.
import { execFileSync } from "node:child_process";
import path from "node:path";

const BIN = path.join(process.env.APPDATA, "npm", "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
// Clear any pre-stealth daemon so the tsx run launches fresh with stealth env.
try { execFileSync(BIN, ["--session", "mirofish-research", "close"], { timeout: 10_000, windowsHide: true }); } catch { /* ignore */ }

const { collectEvidence } = await import("../../src/attention/researchAgent.ts");
const coin = { mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat" };
const t0 = Date.now();
const ev = await collectEvidence(coin, {
  useBrowser: true,
  driver: "agent-browser",
  onAction: (t) => console.log(`  · ${t}`),
});
const byPlatform = {};
for (const p of ev.posts) byPlatform[p.platform] = (byPlatform[p.platform] || 0) + 1;
console.log(`\nDIVE for $${coin.symbol} (${coin.name}) — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`total posts: ${ev.posts.length}`);
console.log(`by platform:`, JSON.stringify(byPlatform));
console.log(`distinct platforms: ${ev.platforms.join(", ")}`);
console.log(`\nsample posts:`);
for (const p of ev.posts.slice(0, 8)) console.log(`  [${p.platform}] ${p.text.slice(0, 90)}`);
process.exit(0);
