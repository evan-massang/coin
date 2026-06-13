// Playwright (Rule 2): the RESEARCH CAM grid shows MULTIPLE lanes live at once.
// Trigger a dive, wait until ≥2 panes have real frames simultaneously, screenshot.
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1600 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`CONSOLE: ${m.text().slice(0, 140)}`); });
try {
  await page.goto("http://127.0.0.1:3000", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  console.log("grid present:", (await page.$("#cam-grid")) ? "YES" : "NO");
  await page.click("#cam-dive");
  console.log("DIVE NOW clicked — waiting for ≥2 panes streaming at once...");

  let maxPanes = 0;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const live = await page.$$eval("#cam-grid .cam-pane.cam-live img", (imgs) =>
      imgs.filter((i) => i.src && i.src.startsWith("data:image/jpeg") && i.src.length > 15000).length,
    ).catch(() => 0);
    maxPanes = Math.max(maxPanes, live);
    if (live >= 2) break;
    await page.waitForTimeout(800);
  }
  const labels = await page.$$eval("#cam-grid .cam-pane .cam-pane-label", (els) => els.map((e) => e.textContent));
  const status = (await page.textContent("#cam-status")).trim();
  console.log("max panes streaming at once:", maxPanes, maxPanes >= 2 ? "→ MULTI-LANE ✓" : "→ only one");
  console.log("status:", status);
  console.log("lane panes:", labels.join(" | "));
  await page.waitForTimeout(1500);
  const panel = await page.$(".camgrid");
  if (panel) await panel.screenshot({ path: "_cctv_grid.png" });
  console.log("errors:", errors.length ? errors.join(" | ") : "none");
  console.log(maxPanes >= 2 ? "OK" : "INSUFFICIENT");
} catch (e) {
  console.log("VERIFY_FAILED:", e.message, "| errors:", errors.join(" | "));
  process.exitCode = 1;
} finally {
  await browser.close();
}
