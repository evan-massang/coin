// Playwright (Rule 2): verify the P0 paper-panel changes render live —
// ledger line under TOTAL PNL, REALIZED EQUITY canvas, RECENT CLOSES columns
// (DD@5M, EXIT REASON) — with console error capture + screenshot evidence.
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1700 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`CONSOLE: ${m.text().slice(0, 200)}`); });
try {
  await page.goto("http://127.0.0.1:3000", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(12000); // one full loadAll cycle

  const pnl = (await page.textContent("#pw-pnl")).replace(/\s+/g, " ");
  console.log("PW-PNL:", pnl.slice(0, 160));
  console.log("ledger line present:", pnl.includes("ledger") ? "YES" : "NO");

  const headers = await page.$$eval(".papergrid table thead th", (els) => els.map((e) => e.textContent.trim()));
  console.log("close-table headers:", headers.join(" | "));
  console.log("DD@5M column:", headers.includes("DD@5M") ? "YES" : "NO", "· EXIT REASON column:", headers.includes("EXIT REASON") ? "YES" : "NO");

  const eq = await page.$("#pw-equity");
  console.log("equity canvas present:", eq ? "YES" : "NO");
  if (eq) {
    const box = await eq.boundingBox();
    console.log("equity canvas box:", box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "none");
  }

  const closes = (await page.textContent("#pw-closes")).replace(/\s+/g, " ").slice(0, 200);
  console.log("closes body sample:", closes);

  const panel = await page.$(".papergrid");
  if (panel) await panel.screenshot({ path: "_p0_paper_panel.png" });
  await page.screenshot({ path: "_p0_dashboard.png", fullPage: false });
  console.log("errors:", errors.length ? errors.join(" | ") : "none");
  console.log("OK");
} catch (e) {
  console.log("VERIFY_FAILED:", e.message, "| errors:", errors.join(" | "));
  process.exitCode = 1;
} finally {
  await browser.close();
}
