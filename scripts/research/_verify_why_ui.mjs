// Playwright: click an open position row → "why holding" dropdown (with console error capture).
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1700 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`CONSOLE: ${m.text().slice(0, 200)}`); });
try {
  await page.goto("http://127.0.0.1:3000", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(12000); // one full loadAll cycle
  const rows = await page.$$eval("#pw-positions tr", (els) => els.length).catch(() => -1);
  console.log("position rows:", rows);
  console.log("errors:", errors.length ? errors.join(" | ") : "none");
  const pos = await page.$("#pw-positions .pw-pos");
  if (pos) {
    await pos.click();
    await page.waitForFunction(() => {
      const w = document.querySelector("#pw-positions .pw-why");
      return w && w.textContent.includes("stop loss");
    }, { timeout: 10000 });
    const why = (await page.textContent("#pw-positions .pw-why")).replace(/\s+/g, " ").slice(0, 280);
    console.log("WHY DROPDOWN:", why);
    await page.screenshot({ path: "data/evidence/why_holding.png" });
    console.log("OK");
  } else {
    console.log("NO .pw-pos rows — body sample:", (await page.textContent("#pw-positions")).slice(0, 150));
  }
} catch (e) {
  console.log("VERIFY_FAILED:", e.message, "| errors:", errors.join(" | "));
  process.exitCode = 1;
} finally {
  await browser.close();
}
