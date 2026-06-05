/** Probe the live PumpPortal feed: subscribe to new tokens, then to each new
 * token's trades, and tally what message types actually arrive. READ-ONLY. */
import WebSocket from "ws";

const ws = new WebSocket("wss://pumpportal.fun/api/data");
const counts: Record<string, number> = {};
let creates = 0, subscribed = 0, tradeMsgs = 0;
let sampleTrade: unknown;
let sampleCreate: unknown;
const watched = new Set<string>();

ws.on("open", () => {
  // eslint-disable-next-line no-console
  console.log("connected; subscribeNewToken");
  ws.send(JSON.stringify({ method: "subscribeNewToken" }));
});

ws.on("message", (d) => {
  let m: Record<string, unknown>;
  try { m = JSON.parse(d.toString()); } catch { return; }
  if (m.message) { counts["__info"] = (counts["__info"] ?? 0) + 1; if (counts["__info"] <= 6) console.log("INFO:", JSON.stringify(m).slice(0, 160)); return; }
  const tx = String(m.txType ?? m.type ?? "?");
  counts[tx] = (counts[tx] ?? 0) + 1;
  if (tx === "create") {
    creates++;
    if (!sampleCreate) sampleCreate = m;
    const mint = m.mint as string | undefined;
    if (mint) { watched.add(mint); subscribed++; ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [mint] })); }
  } else if (tx === "buy" || tx === "sell") {
    tradeMsgs++;
    if (!sampleTrade) sampleTrade = m;
  }
});

ws.on("error", (e) => console.log("ERR", (e as Error).message));

setTimeout(() => {
  // eslint-disable-next-line no-console
  console.log("\n=== after 45s ===");
  console.log("creates seen:", creates, "| token-trade subscriptions sent:", subscribed);
  console.log("buy/sell trade messages received:", tradeMsgs);
  console.log("message-type tally:", JSON.stringify(counts));
  console.log("sample create keys:", sampleCreate ? Object.keys(sampleCreate).join(",") : "(none)");
  console.log("sample trade:", sampleTrade ? JSON.stringify(sampleTrade) : "(NONE — trade stream delivered nothing)");
  ws.close();
  process.exit(0);
}, 80_000);
