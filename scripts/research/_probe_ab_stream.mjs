// Smoke probe: agent-browser WebSocket streaming — enable, connect, count
// frames while navigating, save one frame as JPEG evidence.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import WebSocket from "ws";

const ab = (...args) => {
  try {
    return execFileSync("agent-browser", ["--session", "mirofish", ...args], { encoding: "utf8", timeout: 60_000, shell: process.platform === "win32" });
  } catch (e) {
    return `ERR: ${e.message}`;
  }
};

console.log("stream enable:", ab("stream", "enable", "--json").trim());
const status = ab("stream", "status", "--json").trim();
console.log("stream status:", status);
let port = 9223;
try {
  const j = JSON.parse(status);
  port = j?.data?.port ?? j?.port ?? 9223;
} catch { /* keep default */ }

const ws = new WebSocket(`ws://127.0.0.1:${port}`);
let frames = 0;
let savedOne = false;
let meta = null;
ws.on("open", () => {
  console.log(`ws connected on :${port} — navigating to generate frames...`);
  ab("open", "https://www.bing.com/news/search?q=solana+meme+coin");
});
ws.on("message", (buf) => {
  try {
    const m = JSON.parse(buf.toString());
    if (m.type && !meta) { meta = m.type; console.log("first message type:", m.type, Object.keys(m).join(",")); }
    const b64 = m.data ?? m.frame ?? m.payload?.data;
    if (typeof b64 === "string" && b64.length > 1000) {
      frames++;
      if (!savedOne) {
        fs.writeFileSync("_ab_stream_frame.jpg", Buffer.from(b64, "base64"));
        savedOne = true;
        console.log(`frame saved (_ab_stream_frame.jpg, ${Math.round(b64.length * 0.75 / 1024)}KB)`);
      }
    }
  } catch { /* non-JSON frame? */ }
});
ws.on("error", (e) => console.log("ws error:", e.message));
setTimeout(() => {
  console.log(`RESULT: ${frames} frames received in 12s ${frames > 0 ? "— STREAMING VERIFIED" : "— NO FRAMES"}`);
  ws.close();
  process.exit(0);
}, 12_000);
