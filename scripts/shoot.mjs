// Screenshot the dashboard + report any console / page errors. Verification only.
import { chromium } from "playwright";

const URL = process.env.SHOOT_URL || "http://localhost:3010";
const OUT = process.env.SHOOT_OUT || "./.verify-data/dashboard.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1320, height: 1500 }, deviceScaleFactor: 2 });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1500); // let the graph animate + selection settle
// click the second row to exercise selection of a different token
const rows = await page.$$("#feed tr[data-mint]");
if (rows.length > 1) { await rows[1].click(); await page.waitForTimeout(900); }
await page.screenshot({ path: OUT, fullPage: true });

console.log("SHOT:", OUT);
console.log("ERRORS:", errors.length ? JSON.stringify(errors, null, 2) : "none");
await browser.close();
