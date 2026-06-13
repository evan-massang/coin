// Rule 6 (audit before coding): does a small set of anti-detection flags on
// agent-browser itself clear the challenges, before we consider a heavier
// (Python) framework? Tests vanilla vs stealth args against the walled sources.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BIN = process.env.APPDATA
  ? path.join(process.env.APPDATA, "npm", "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe")
  : "agent-browser";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function ab(session, args, timeout = 45_000) {
  try {
    return execFileSync(BIN, ["--session", session, ...args], { encoding: "utf8", timeout, windowsHide: true });
  } catch (e) {
    return `ERR ${String(e.message).slice(0, 80)}`;
  }
}

// Two configs: vanilla vs stealth (disable AutomationControlled + real UA + extra args).
const STEALTH = [
  "--user-agent", UA,
  "--args", "--disable-blink-features=AutomationControlled,--disable-features=IsolateOrigins,site-per-process",
];

const TARGETS = [
  { name: "bing-web", url: "https://www.bing.com/search?q=%22dogwifhat%22+meme&mkt=en-US", probe: "JSON.stringify({title:document.title.slice(0,40),algo:document.querySelectorAll('li.b_algo').length,challenge:/challenge|verify|are you (a )?human|one last step/i.test(document.body.innerText.slice(0,400))})" },
  { name: "brave", url: "https://search.brave.com/search?q=%22dogwifhat%22+meme", probe: "JSON.stringify({title:document.title.slice(0,40),n:document.querySelectorAll('.snippet').length,challenge:/challenge|not a bot|verify|captcha|last step/i.test(document.body.innerText.slice(0,400))})" },
  { name: "reddit", url: "https://old.reddit.com/search?q=dogwifhat&sort=new", probe: "JSON.stringify({title:document.title.slice(0,40),n:document.querySelectorAll('.search-result-link').length,challenge:/whoa there|blocked|challenge|just a moment/i.test(document.body.innerText.slice(0,400))})" },
  { name: "ddg-html", url: "https://html.duckduckgo.com/html/?q=dogwifhat", probe: "JSON.stringify({title:document.title.slice(0,40),n:document.querySelectorAll('.result').length,blocked:/internet baik|blocked|block\\?/i.test(location.href+document.body.innerText.slice(0,200))})" },
  { name: "nitter", url: "https://nitter.net/search?q=dogwifhat", probe: "JSON.stringify({title:document.title.slice(0,40),n:document.querySelectorAll('.timeline-item').length})" },
];

for (const mode of ["vanilla", "stealth"]) {
  const session = `probe-${mode}`;
  ab(session, ["close"]); // fresh
  console.log(`\n===== ${mode.toUpperCase()} =====`);
  for (const t of TARGETS) {
    const openArgs = mode === "stealth" ? [...STEALTH, "--ignore-https-errors", "open", t.url, "--json"] : ["--ignore-https-errors", "open", t.url, "--json"];
    const opened = ab(session, openArgs);
    ab(session, ["wait", "2500"]);
    const r = ab(session, ["eval", t.probe, "--json"]);
    let out = r.trim();
    try {
      const env = JSON.parse(out);
      out = typeof env.data === "string" ? env.data : JSON.stringify(env.data);
    } catch { /* keep raw */ }
    console.log(`  ${t.name.padEnd(10)} ${out.slice(0, 140)}`);
  }
  // screenshot of the last target for the record
  ab(session, ["screenshot", `_stealth_${mode}.png`]);
  ab(session, ["close"]);
}
console.log("\ndone — screenshots _stealth_vanilla.png / _stealth_stealth.png");
