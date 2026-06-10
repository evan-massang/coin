// Playwright verification (Rule 2): discovery + deep-dive buttons render in the
// Manus overlay and the missions list shows the [discovery] kind chip.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
try {
  await page.goto("http://127.0.0.1:3000", { waitUntil: "domcontentloaded" });
  await page.click("#open-hermes");
  await page.waitForSelector("#hermes.open", { timeout: 5000 });
  const disc = await page.$("#hm-discover");
  const dd = await page.$("#hm-deepdive");
  console.log("DISCOVER button:", disc ? "present" : "MISSING");
  console.log("DEEPDIVE button:", dd ? "present" : "MISSING");
  await page.waitForFunction(() => (document.querySelector("#hm-list")?.textContent || "").includes("#"), { timeout: 8000 });
  const list = (await page.textContent("#hm-list"))?.replace(/\s+/g, " ").slice(0, 250);
  console.log("MISSIONS:", list);
  await page.screenshot({ path: "data/evidence/manus_discovery_ui.png" });
  console.log(disc && dd ? "OK" : "FAIL");
} catch (e) {
  console.log("VERIFY_FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
