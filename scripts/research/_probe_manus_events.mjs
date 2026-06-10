// Dump the RAW event shapes from a real finished Manus task so the chat
// extractor matches reality, not guesses.
import Database from "better-sqlite3";
const db = new Database("data/sniper.sqlite", { readonly: true });
const apiKey = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='manusApiKey'").get().value);
const taskId = process.argv[2] ?? "dxKC5eUkLUimeihnhKaUAd"; // hunt #12
db.close();
const res = await fetch(`https://api.manus.ai/v2/task.listMessages?task_id=${taskId}&order=desc&limit=100`, {
  headers: { "x-manus-api-key": apiKey },
});
const body = await res.json();
const events = Array.isArray(body) ? body : body.events ?? body.messages ?? body.data ?? [];
console.log(`HTTP ${res.status} · ${events.length} events · envelope keys: ${Object.keys(body).join(",")}`);
const typeCounts = {};
for (const ev of events) {
  const t = ev?.type ?? ev?.event ?? "?";
  typeCounts[t] = (typeCounts[t] ?? 0) + 1;
}
console.log("event types:", JSON.stringify(typeCounts));
// Show the structure of the first 3 distinct types (truncated)
const seen = new Set();
for (const ev of events) {
  const t = ev?.type ?? ev?.event ?? "?";
  if (seen.has(t)) continue;
  seen.add(t);
  console.log(`\n=== sample "${t}" ===`);
  console.log(JSON.stringify(ev).slice(0, 700));
  if (seen.size >= 5) break;
}
