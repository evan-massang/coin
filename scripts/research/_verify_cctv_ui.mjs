// Playwright (Rule 2): verify the RESEARCH CAM goes LIVE during a dive —
// frames render in #cam-frame, the action ticker fills, REC blinks. Triggers a
// dive via the UI button, waits for frames, screenshots the panel.
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`CONSOLE: ${m.text().slice(0, 160)}`); });
try {
  await page.goto("http://127.0.0.1:3000", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  console.log("cam panel present:", (await page.$("#cam-screen")) ? "YES" : "NO");
  await page.click("#cam-dive");
  console.log("DIVE NOW clicked — waiting for live frames (dive takes ~20-60s)...");

  let live = false;
  try {
    await page.waitForFunction(() => {
      const img = document.querySelector("#cam-frame");
      return img && img.src.startsWith("data:image/jpeg") && img.src.length > 20_000;
    }, { timeout: 90_000 });
    live = true;
  } catch {
    /* report below */
  }
  const status = (await page.textContent("#cam-status")).trim();
  const ticker = (await page.textContent("#cam-ticker")).replace(/\s+/g, " ").slice(0, 400);
  const imgLen = await page.$eval("#cam-frame", (i) => i.src.length).catch(() => 0);
  console.log("LIVE frames:", live ? "YES" : "NO", `(img data length ${imgLen})`);
  console.log("status:", status);
  console.log("ticker:", ticker);

  const panel = await page.$(".camgrid");
  if (panel) await panel.screenshot({ path: "_cctv_panel.png" });
  console.log("errors:", errors.length ? errors.join(" | ") : "none");
  console.log(live ? "OK" : "NO_FRAMES");
} catch (e) {
  console.log("VERIFY_FAILED:", e.message, "| errors:", errors.join(" | "));
  process.exitCode = 1;
} finally {
  await browser.close();
}
