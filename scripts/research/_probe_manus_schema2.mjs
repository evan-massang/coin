// Find the property-count threshold the live Manus validator allows per object.
import Database from "better-sqlite3";
const db = new Database("data/sniper.sqlite", { readonly: true });
const apiKey = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='manusApiKey'").get().value);
db.close();

async function probe(nProps, inArray) {
  const props = {};
  for (let i = 0; i < nProps; i++) props[`f${i}`] = { type: i % 3 === 0 ? "number" : "string", description: `field number ${i} of the record` };
  const inner = { type: "object", additionalProperties: false, properties: props, required: ["f0"] };
  const schema = inArray
    ? { type: "object", additionalProperties: false, properties: { xs: { type: "array", items: inner } }, required: ["xs"] }
    : inner;
  const res = await fetch("https://api.manus.ai/v2/task.create", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-manus-api-key": apiKey },
    body: JSON.stringify({ message: { content: "Reply done, fill 0/done." }, interactive_mode: false, hide_in_task_list: true, title: "probe", structured_output_schema: schema }),
  });
  const text = await res.text();
  let taskId; try { taskId = JSON.parse(text).task_id; } catch { /* */ }
  console.log(`${inArray ? "array-item" : "root      "} props=${String(nProps).padStart(2)}: HTTP ${res.status}`);
  if (taskId) await fetch("https://api.manus.ai/v2/task.delete", { method: "POST", headers: { "Content-Type": "application/json", "x-manus-api-key": apiKey }, body: JSON.stringify({ task_id: taskId }) });
}

for (const n of [10, 12, 14, 16]) await probe(n, true);
await probe(16, false); // is the limit array-specific or global?
