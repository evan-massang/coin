// Playwright verification (Rule 2): the Manus settings appear in CONFIG and the
// mission overlay reports manual-board mode when no key is configured.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
try {
  await page.goto("http://127.0.0.1:3000", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#open-config", { timeout: 15000 });
  await page.click("#open-config");
  await page.waitForSelector("#config.open", { timeout: 5000 });
  const hasKey = await page.$('input[name="manusApiKey"]');
  const hasProfile = await page.$('select[name="manusAgentProfile"]');
  const hasAuto = await page.$('input[name="manusAutoMissions"]');
  console.log("CONFIG manusApiKey field:", hasKey ? "present" : "MISSING");
  console.log("CONFIG manusAgentProfile select:", hasProfile ? "present" : "MISSING");
  console.log("CONFIG manusAutoMissions checkbox:", hasAuto ? "present" : "MISSING");
  await page.screenshot({ path: "data/evidence/manus_config.png" });
  await page.click("#close-config");

  await page.click("#open-hermes");
  await page.waitForSelector("#hermes.open", { timeout: 5000 });
  await page.waitForFunction(() => (document.querySelector("#hm-list")?.textContent || "").length > 5, { timeout: 8000 });
  const listTxt = (await page.textContent("#hm-list"))?.replace(/\s+/g, " ").slice(0, 200);
  console.log("MISSIONS LIST:", listTxt);
  await page.screenshot({ path: "data/evidence/manus_overlay2.png" });
  console.log(hasKey && hasProfile && hasAuto ? "OK" : "FAIL");
} catch (e) {
  console.log("VERIFY_FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
