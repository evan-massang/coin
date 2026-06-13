// Verify the parallel multi-lane CCTV end-to-end through the ENGINE: trigger a
// dive, watch the dashboard websocket, tally frames + actions PER LANE and the
// wall-clock. Proves lanes stream concurrently (not one-at-a-time).
import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:3000/ws");
const lanes = new Map(); // id -> { frames, firstAt, lastAt, label }
const actionsByLane = new Map();
let diveStart = 0, diveEnd = 0;

ws.on("open", async () => {
  console.log("connected to dashboard ws — triggering a dive...");
  const r = await fetch("http://127.0.0.1:3000/api/browsercam/dive", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  }).then((x) => x.json()).catch((e) => ({ ok: false, error: String(e) }));
  console.log("dive:", JSON.stringify(r));
  diveStart = Date.now();
});

ws.on("message", (buf) => {
  let m; try { m = JSON.parse(buf.toString()); } catch { return; }
  if (m.type !== "browsercam") return;
  const d = m.data;
  if (d.kind === "frame") {
    const L = lanes.get(d.lane) || { frames: 0, firstAt: Date.now(), lastAt: 0, label: d.label };
    L.frames++; L.lastAt = Date.now(); L.label = d.label || L.label;
    lanes.set(d.lane, L);
  } else if (d.kind === "action") {
    actionsByLane.set(d.lane, (actionsByLane.get(d.lane) || 0) + 1);
  } else if (d.kind === "dive" && d.status === "idle") {
    diveEnd = Date.now();
  }
});

setTimeout(() => {
  const end = diveEnd || Date.now();
  console.log(`\n=== RESEARCH CAM lanes (wall-clock ${((end - diveStart) / 1000).toFixed(1)}s) ===`);
  const ids = new Set([...lanes.keys(), ...actionsByLane.keys()]);
  // Concurrency proof: how many lanes were streaming frames at the same moment?
  let maxConcurrent = 0;
  const t0 = Math.min(...[...lanes.values()].map((l) => l.firstAt).filter(Boolean), Date.now());
  for (let t = t0; t < end; t += 1000) {
    const active = [...lanes.values()].filter((l) => l.firstAt <= t && l.lastAt >= t).length;
    maxConcurrent = Math.max(maxConcurrent, active);
  }
  for (const id of ids) {
    const L = lanes.get(id);
    console.log(`  ${String(id).padEnd(8)} ${L ? `${L.frames} frames (${((L.lastAt - L.firstAt) / 1000).toFixed(1)}s live)` : "no frames"} · ${actionsByLane.get(id) || 0} actions ${L?.label ? "[" + L.label + "]" : ""}`);
  }
  console.log(`\nlanes that streamed frames: ${lanes.size}`);
  console.log(`MAX LANES STREAMING AT ONCE: ${maxConcurrent}  ${maxConcurrent >= 2 ? "→ CONCURRENT ✓" : "→ NOT concurrent"}`);
  ws.close();
  process.exit(0);
}, 70_000);
