// One-off: cancel discovery #9 (engineer-voice prompt, superseded by the
// operator-verbatim prompt). Engine must be STOPPED (direct DB write).
import Database from "better-sqlite3";
const db = new Database("data/sniper.sqlite");
const row = db.prepare("SELECT external_id, status FROM missions WHERE id=9").get();
console.log("mission 9:", row);
if (row?.external_id && row.status === "sent") {
  const apiKey = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='manusApiKey'").get().value);
  const del = await fetch("https://api.manus.ai/v2/task.delete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-manus-api-key": apiKey },
    body: JSON.stringify({ task_id: row.external_id }),
  });
  console.log("manus task.delete:", del.status);
  db.prepare("UPDATE missions SET status='failed', error='superseded: operator-verbatim prompt replaces the engineer-voice prompt', resolved_at=? WHERE id=9").run(Date.now());
  console.log("mission 9 marked superseded");
} else {
  console.log("nothing to cancel (already terminal or never sent)");
}
db.close();
