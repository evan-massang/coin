import { chromium } from "playwright";
const b = await chromium.launch();
const pg = await b.newPage();
try {
  await pg.goto("http://localhost:3000", { waitUntil: "load", timeout: 20000 });
  await pg.waitForTimeout(3500);
  const ids = ["pw-status", "pw-bal", "pw-pnl", "pw-win", "pw-open", "pw-closed"];
  for (const id of ids) {
    const t = await pg.$eval(`#${id}`, (el) => el.innerText.replace(/\s+/g, " ").trim()).catch(() => "(not found)");
    console.log(`#${id}: ${t}`);
  }
} catch (e) { console.log("err:", e.message); } finally { await b.close(); }
