// Playwright screenshot helper: node scripts/research/_shot.mjs <url> <out.png>
import { chromium } from "playwright";
const url = process.argv[2] || "http://localhost:3000";
const out = process.argv[3] || "_shot.png";
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1440, height: 1024 }, deviceScaleFactor: 2 });
try {
  await pg.goto(url, { waitUntil: "load", timeout: 20000 });
  await pg.waitForTimeout(3000); // let charts render + ws data arrive
  await pg.screenshot({ path: out, fullPage: true });
  const el = await pg.$("#pchart");
  if (el) await el.screenshot({ path: out.replace(/\.png$/, "_chart.png") });
  console.log("shot saved:", out, el ? "(+chart)" : "(no #pchart found)");
} catch (e) {
  console.log("shot error:", e.message);
} finally {
  await b.close();
}
