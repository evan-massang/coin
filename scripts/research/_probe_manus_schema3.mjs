// Hypothesis: Manus structured-output (like OpenAI strict mode) requires EVERY
// property to be listed in `required`.
import Database from "better-sqlite3";
const db = new Database("data/sniper.sqlite", { readonly: true });
const apiKey = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='manusApiKey'").get().value);
db.close();

async function probe(label, nProps, allRequired, inArray) {
  const props = {};
  for (let i = 0; i < nProps; i++) props[`f${i}`] = { type: i % 3 === 0 ? "number" : "string", description: `field ${i}` };
  const inner = { type: "object", additionalProperties: false, properties: props, required: allRequired ? Object.keys(props) : ["f0"] };
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
  console.log(`${label}: HTTP ${res.status}`);
  if (taskId) await fetch("https://api.manus.ai/v2/task.delete", { method: "POST", headers: { "Content-Type": "application/json", "x-manus-api-key": apiKey }, body: JSON.stringify({ task_id: taskId }) });
}

await probe("root 10 props ALL required      ", 10, true, false);
await probe("array-item 17 props ALL required", 17, true, true);
await probe("root 3 props PARTIAL required   ", 3, false, false);
