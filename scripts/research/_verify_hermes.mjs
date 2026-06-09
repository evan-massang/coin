// Playwright verification of the Hermes / Manus operator panel (CLAUDE.md Rule 2).
// Drives the real dashboard: open the Manus overlay, compose a mission, submit a
// recommendation (re-scores through decide), and load the case file. Captures
// screenshots as evidence. Read-only against the live engine on :3000.
//
//   node scripts/research/_verify_hermes.mjs [mint]
import { chromium } from "playwright";

const mint = process.argv[2] || "7KqAJHafZum7sJ6EbaDPZhPLmvsPyDWPMZLo7jC5pump";
const out = "data/evidence";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1700 } });
try {
  await page.goto("http://127.0.0.1:3000", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#open-hermes", { timeout: 15000 });
  await page.screenshot({ path: `${out}/hermes_1_dashboard.png`, fullPage: true });

  await page.click("#open-hermes");
  await page.waitForSelector("#hermes.open", { timeout: 5000 });
  await page.fill("#hm-mint", mint);
  await page.click("#hm-compose");
  await page.waitForFunction(() => (document.querySelector("#hm-mission")?.textContent || "").includes("gaps to verify"), { timeout: 12000 });
  const compose = (await page.textContent("#hm-out"))?.trim();
  const buckets = await page.$$eval("#hm-mission div[style*='border']", (els) => els.length);
  await page.screenshot({ path: `${out}/hermes_2_mission.png` });

  await page.selectOption("#hm-rec", "confirm");
  await page.fill("#hm-conf", "82");
  await page.fill("#hm-narr", "playwright verify: organic community, spreading on tiktok");
  await page.click("#hm-submit");
  await page.waitForFunction(() => (document.querySelector("#hm-out")?.textContent || "").includes("re-scored"), { timeout: 12000 });
  const submit = (await page.textContent("#hm-out"))?.trim();

  await page.fill("#hm-mint", mint);
  await page.click("#hm-case");
  await page.waitForFunction(() => (document.querySelector("#hm-casefile")?.textContent || "").includes("timeline"), { timeout: 10000 });
  await page.screenshot({ path: `${out}/hermes_3_case.png` });
  const caseTxt = (await page.textContent("#hm-casefile"))?.replace(/\s+/g, " ").trim().slice(0, 320);

  console.log("BUCKETS_RENDERED:", buckets);
  console.log("COMPOSE_OUT:", compose);
  console.log("SUBMIT_OUT:", submit);
  console.log("CASE_FILE:", caseTxt);
  console.log("OK");
} catch (e) {
  console.log("VERIFY_FAILED:", e.message);
  await page.screenshot({ path: `${out}/hermes_error.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
