// Bisect the live Manus structured-output validator: which schema shapes does
// task.create accept? 400s are free; any created trivial task is deleted.
import Database from "better-sqlite3";
const db = new Database("data/sniper.sqlite", { readonly: true });
const row = db.prepare("SELECT value FROM settings WHERE key='manusApiKey'").get();
db.close();
const apiKey = JSON.parse(row.value);
const BASE = "https://api.manus.ai";

async function probe(label, schema) {
  const res = await fetch(`${BASE}/v2/task.create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-manus-api-key": apiKey },
    body: JSON.stringify({
      message: { content: "Reply with the structured output filled with the single word done where strings are required and 0 for numbers. Do no research." },
      interactive_mode: false,
      hide_in_task_list: true,
      title: "schema probe",
      structured_output_schema: schema,
    }),
  });
  const text = await res.text();
  let taskId;
  try { taskId = JSON.parse(text).task_id; } catch { /* ignore */ }
  console.log(`${label}: HTTP ${res.status}${res.status !== 200 ? " → " + text.slice(0, 140) : " (accepted)"}`);
  if (taskId) {
    const del = await fetch(`${BASE}/v2/task.delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-manus-api-key": apiKey },
      body: JSON.stringify({ task_id: taskId }),
    });
    console.log(`   cleanup task.delete: HTTP ${del.status}`);
  }
}

// 1. Flat object (the shape that WORKED for mission #5)
await probe("flat object        ", {
  type: "object", additionalProperties: false,
  properties: { a: { type: "string" } }, required: ["a"],
});
// 2. Array of STRINGS (also present in the working schema)
await probe("array of strings   ", {
  type: "object", additionalProperties: false,
  properties: { xs: { type: "array", items: { type: "string" } } }, required: ["xs"],
});
// 3. Array of OBJECTS (minimal — the discovery shape)
await probe("array of objects   ", {
  type: "object", additionalProperties: false,
  properties: { xs: { type: "array", items: { type: "object", additionalProperties: false, properties: { a: { type: "string" } }, required: ["a"] } } },
  required: ["xs"],
});
// 4. Array of objects + description on the array (discovery has this)
await probe("arr objs + desc    ", {
  type: "object", additionalProperties: false,
  properties: { xs: { type: "array", description: "list", items: { type: "object", additionalProperties: false, properties: { a: { type: "string", description: "field" } }, required: ["a"] } } },
  required: ["xs"],
});
// 5. Array of objects with MANY properties (17, like the candidate)
const manyProps = {};
for (let i = 0; i < 17; i++) manyProps[`f${i}`] = { type: i % 3 === 0 ? "number" : "string", description: `field ${i}` };
await probe("arr objs 17 props  ", {
  type: "object", additionalProperties: false,
  properties: { xs: { type: "array", items: { type: "object", additionalProperties: false, properties: manyProps, required: ["f0"] } }, n: { type: "number" }, note: { type: "string" } },
  required: ["xs", "n", "note"],
});
