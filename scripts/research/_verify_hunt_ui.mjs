// Playwright (Rule 2): the hunt-results panel shows the picks and the attach box renders.
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
try {
  await page.goto("http://127.0.0.1:3000", { waitUntil: "domcontentloaded" });
  await page.click("#open-hermes");
  await page.waitForSelector("#hermes.open", { timeout: 5000 });
  await page.waitForFunction(() => (document.querySelector("#hm-hunt")?.textContent || "").includes("mint:"), { timeout: 10000 });
  const hunt = (await page.textContent("#hm-hunt"))?.replace(/\s+/g, " ").slice(0, 300);
  console.log("HUNT PANEL:", hunt);
  console.log("ATTACH BOX:", (await page.$("#hm-attach")) ? "present" : "MISSING");
  await page.screenshot({ path: "data/evidence/manus_hunt_results.png", fullPage: false });
  console.log("OK");
} catch (e) {
  console.log("VERIFY_FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
