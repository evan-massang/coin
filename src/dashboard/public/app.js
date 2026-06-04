"use strict";
// MEMEFISH terminal — single-screen, real data, dependency-free canvas viz.

const $ = (s, r = document) => r.querySelector(s);
const api = async (p, o) =>
  (await fetch(`/api${p}`, { headers: { "Content-Type": "application/json" }, ...o, body: o && o.body ? JSON.stringify(o.body) : undefined })).json();
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sign = (n, d = 2) => (n >= 0 ? "+" : "") + Number(n || 0).toFixed(d);
const pct = (n) => (n >= 0 ? "+" : "") + Math.round(n || 0) + "%";

const COL = { paper: "#f6f2e6", ink: "#21241d", green: "#2f8f4e", greenB: "#3aa85c", red: "#cf4b41", gold: "#c98a2b", muted: "#9a9886", line: "#d4ccb4" };
const VC = { BUY_STRONG: COL.greenB, BUY_SMALL: COL.green, WATCH_ONLY: COL.muted, TOO_LATE: COL.gold, AVOID: COL.red, SELL_TRIM: COL.gold, SELL_EXIT_NOW: COL.red };
const vcol = (v) => VC[v] || COL.muted;

const STATE = { signals: [], nodes: [], paper: null, stats: null, status: null };

// ── live clock ──
function tick() {
  const d = new Date();
  $("#t-clock").textContent = d.toISOString().slice(11, 19);
}
setInterval(tick, 1000);
tick();

// ── canvas helpers ──
function fit(cv, cssH) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 600;
  cv.style.height = cssH + "px";
  cv.width = Math.max(1, Math.floor(w * dpr));
  cv.height = Math.floor(cssH * dpr);
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, cssH);
  return { ctx, w, h: cssH };
}

// ── data load ──
async function loadAll() {
  const [status, stats, paper, signals] = await Promise.all([
    api("/status").catch(() => null),
    api("/journal/stats").catch(() => null),
    api("/paper").catch(() => null),
    api("/signals?limit=120").catch(() => []),
  ]);
  STATE.status = status;
  STATE.stats = stats;
  STATE.paper = paper;
  STATE.signals = (signals || []).map((s) => ({ ...s, kind: s.verdict })).reverse(); // oldest→newest
  buildNodes();
  renderHero();
  renderTopPanel();
  renderMarquee();
  drawCandles();
  drawBars();
  drawCurve();
}

function paperTotalPnl() {
  const st = STATE.paper && STATE.paper.stats;
  return st ? (st.realizedPnlSol || 0) + (st.unrealizedPnlSol || 0) : 0;
}

function renderHero() {
  const st = STATE.stats || {};
  const total = st.total || STATE.signals.length;
  const buys = ((st.byVerdict || {}).BUY_SMALL || 0) + ((st.byVerdict || {}).BUY_STRONG || 0);
  const win = Math.round((st.winRate || 0) * 100);
  const pnl = paperTotalPnl();
  const heroEl = $("#hero-pnl");
  heroEl.textContent = sign(pnl);
  heroEl.style.color = pnl >= 0 ? COL.green : COL.red;
  $("#hero-sub").innerHTML = `${total} signals · ${buys} buy · <b class="green">${win}% win</b> · ${perDay()}/day`;
  const w = (STATE.status && STATE.status.wallet) || {};
  $("#hero-walletline").innerHTML = `WALLET <span class="muted">${esc(w.address ? w.address.slice(0, 6) + "…" + w.address.slice(-4) : "not set")}</span> · paper sim ${STATE.paper && STATE.paper.enabled ? "ON" : "off"}`;
  $("#t-wallet").textContent = w.address ? w.address.slice(0, 6) + "…" + w.address.slice(-6) : "no wallet";
  $("#hero-mode").textContent = STATE.status && STATE.status.modes && STATE.status.modes.paperTrading ? "● PAPER LIVE" : "● SIGNALS";

  // biggest win
  const best = STATE.paper && STATE.paper.stats ? STATE.paper.stats.bestTradePct : st.avgMaxGainPct;
  $("#win-big").textContent = best ? pct(best) : "—";

  // hero dot row (recent verdicts)
  $("#hero-dots").innerHTML = STATE.signals.slice(-40).map((s) => `<i style="background:${vcol(s.verdict)}"></i>`).join("");

  // cash-flow block
  const cf = $("#cf-pnl");
  cf.textContent = sign(pnl);
  cf.style.color = pnl >= 0 ? COL.green : COL.red;
  $("#st-trades").textContent = total;
  $("#st-win").textContent = win + "%";
  $("#st-avg").textContent = pct(st.avgMaxGainPct || 0);
  $("#st-best").textContent = best ? pct(best) : "0%";
}

function perDay() {
  const s = STATE.signals;
  if (s.length < 2) return s.length;
  const days = Math.max((s[s.length - 1].at - s[0].at) / 86400000, 1 / 24);
  return Math.round(s.length / days);
}

function renderTopPanel() {
  const top = [...STATE.signals].sort((a, b) => b.conviction - a.conviction)[0];
  if (!top) return;
  $("#tp-verdict").textContent = top.verdict;
  $("#tp-verdict").style.color = vcol(top.verdict);
  $("#tp-conv").textContent = Math.round(top.conviction);
  $("#tp-safety").textContent = Math.round(top.scores.safety);
  $("#tp-mom").textContent = Math.round(top.scores.momentum);
  $("#tp-risk").textContent = top.riskTier || "—";
  const rf = (top.redFlags && top.redFlags[0]) || (top.flags && top.flags[0]) || "";
  $("#tp-flag").textContent = rf ? "⚠ " + rf : "";
  $("#legend").innerHTML = [
    ["BUY", COL.greenB], ["WATCH", COL.muted], ["AVOID", COL.red], ["SELL", COL.gold],
  ].map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join("");
}

function renderMarquee() {
  const st = STATE.stats || {};
  const seg = `ALL-TIME PAPER ${sign(paperTotalPnl())} SOL  ·  BIGGEST WIN ${$("#win-big").textContent}  ·  WIN RATE ${Math.round((st.winRate || 0) * 100)}%  ·  SIGNALS ${st.total || 0}  ·  ◎ MEMEFISH SIGNAL TERMINAL  ·  READ-ONLY`;
  $("#marquee").textContent = (seg + "    ").repeat(2);
}

// ── relationship graph (force-ish sim) ──
function buildNodes() {
  const recent = STATE.signals.slice(-44);
  STATE.nodes = recent.map((s, i) => {
    const prev = STATE.nodes.find((n) => n.mint === s.mint);
    return {
      mint: s.mint, verdict: s.verdict,
      r: 3 + (s.conviction / 100) * 7,
      x: prev ? prev.x : 270 + Math.cos(i) * (40 + (i % 7) * 14),
      y: prev ? prev.y : 150 + Math.sin(i * 1.3) * (30 + (i % 5) * 12),
      vx: 0, vy: 0,
    };
  });
}
function pushNode(s) {
  STATE.nodes.push({ mint: s.mint, verdict: s.verdict, r: 3 + (s.conviction / 100) * 7, x: 270 + (Math.random() * 40 - 20), y: 150 + (Math.random() * 40 - 20), vx: 0, vy: 0 });
  if (STATE.nodes.length > 44) STATE.nodes.shift();
}
function stepGraph(w, h) {
  const ns = STATE.nodes, cx = w / 2, cy = h / 2;
  for (let i = 0; i < ns.length; i++) {
    const a = ns[i];
    a.vx += (cx - a.x) * 0.0009;
    a.vy += (cy - a.y) * 0.0009; // gravity to center
    for (let j = i + 1; j < ns.length; j++) {
      const b = ns[j];
      let dx = a.x - b.x, dy = a.y - b.y;
      let d2 = dx * dx + dy * dy || 1;
      const f = 240 / d2;
      const d = Math.sqrt(d2);
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
  }
  // chain spring (temporal edges)
  for (let i = 1; i < ns.length; i++) {
    const a = ns[i - 1], b = ns[i];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, k = (d - 46) * 0.01;
    a.vx += (dx / d) * k; a.vy += (dy / d) * k;
    b.vx -= (dx / d) * k; b.vy -= (dy / d) * k;
  }
  for (const a of ns) {
    a.vx *= 0.86; a.vy *= 0.86;
    a.x = Math.max(a.r + 2, Math.min(w - a.r - 2, a.x + a.vx));
    a.y = Math.max(a.r + 2, Math.min(h - a.r - 2, a.y + a.vy));
  }
}
let graphCv;
function drawGraph() {
  if (!graphCv) graphCv = $("#graph");
  const { ctx, w, h } = fit(graphCv, 300);
  stepGraph(w, h);
  const ns = STATE.nodes;
  ctx.strokeStyle = "rgba(120,120,90,0.25)";
  ctx.lineWidth = 1;
  for (let i = 1; i < ns.length; i++) {
    ctx.beginPath(); ctx.moveTo(ns[i - 1].x, ns[i - 1].y); ctx.lineTo(ns[i].x, ns[i].y); ctx.stroke();
  }
  for (const a of ns) {
    ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, 7); ctx.fillStyle = vcol(a.verdict); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.stroke();
  }
  $("#graph-stats").textContent = `nodes ${ns.length} · edges ${Math.max(0, ns.length - 1)}`;
  requestAnimationFrame(drawGraph);
}

// ── candlestick: conviction bucketed over time ──
function drawCandles() {
  const cv = $("#candles"); const { ctx, w, h } = fit(cv, 190);
  const s = STATE.signals; if (s.length < 2) return;
  const N = Math.min(30, Math.max(6, Math.floor(w / 22)));
  const per = Math.ceil(s.length / N);
  const candles = [];
  for (let i = 0; i < s.length; i += per) {
    const chunk = s.slice(i, i + per).map((x) => x.conviction);
    if (!chunk.length) continue;
    candles.push({ o: chunk[0], c: chunk[chunk.length - 1], hi: Math.max(...chunk), lo: Math.min(...chunk) });
  }
  const pad = 8, cw = (w - pad * 2) / candles.length;
  const max = 100, min = 0, sc = (v) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
  ctx.strokeStyle = COL.line; ctx.beginPath(); ctx.moveTo(0, sc(50)); ctx.lineTo(w, sc(50)); ctx.stroke();
  candles.forEach((cd, i) => {
    const x = pad + i * cw + cw / 2;
    const up = cd.c >= cd.o; const col = up ? COL.green : COL.red;
    ctx.strokeStyle = col; ctx.fillStyle = up ? "#e7f0e0" : col;
    ctx.beginPath(); ctx.moveTo(x, sc(cd.hi)); ctx.lineTo(x, sc(cd.lo)); ctx.stroke();
    const bw = Math.max(2, cw * 0.5), top = sc(Math.max(cd.o, cd.c)), bot = sc(Math.min(cd.o, cd.c));
    ctx.fillRect(x - bw / 2, top, bw, Math.max(1, bot - top));
    ctx.strokeRect(x - bw / 2, top, bw, Math.max(1, bot - top));
  });
  const last = s[s.length - 1];
  $("#flow-now").textContent = "conv " + Math.round(last.conviction);
  $("#flow-now").style.color = last.conviction >= 50 ? COL.green : COL.red;
}

// ── last-30 bar chart ──
function drawBars() {
  const cv = $("#bars"); const { ctx, w, h } = fit(cv, 120);
  const s = STATE.signals.slice(-30); if (!s.length) return;
  const pad = 4, bw = (w - pad * 2) / s.length;
  s.forEach((x, i) => {
    const bh = (x.conviction / 100) * (h - 8);
    ctx.fillStyle = vcol(x.verdict);
    ctx.fillRect(pad + i * bw + 1, h - bh - 2, Math.max(1, bw - 2), bh);
  });
}

// ── pnl curve (paper fills cumulative, else conviction pseudo-equity) ──
function drawCurve() {
  const cv = $("#curve"); const { ctx, w, h } = fit(cv, 210);
  // Real paper realized-PnL curve only. Hypothetical fallback: cumulative
  // realized gain from RESOLVED buy signals. Otherwise a clean placeholder —
  // never a misleading made-up "loss" line.
  let series = [];
  const fills = (STATE.paper && STATE.paper.fills) || [];
  if (fills.length >= 2) {
    const ordered = [...fills].reverse(); let acc = 0;
    series = ordered.map((f) => (acc += f.realizedPnlSol || 0));
    $("#curve-window").textContent = "paper · SOL";
  } else {
    let acc = 0; const pts = [];
    for (const s of STATE.signals) {
      if ((s.verdict === "BUY_SMALL" || s.verdict === "BUY_STRONG") && s.maxGainPct != null) { acc += s.maxGainPct / 100; pts.push(acc); }
    }
    series = pts;
    $("#curve-window").textContent = "hypothetical · x";
  }
  if (series.length < 2) {
    ctx.fillStyle = COL.muted; ctx.font = "18px VT323";
    ctx.fillText("awaiting paper trades / resolved buys…", 12, h / 2);
    $("#cv-peak").textContent = "—"; $("#cv-cur").textContent = "—"; $("#cv-dd").textContent = "—";
    return;
  }
  const max = Math.max(...series, 0), min = Math.min(...series, 0), pad = 12;
  const sx = (i) => pad + (i / (series.length - 1)) * (w - pad * 2);
  const sy = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
  ctx.strokeStyle = COL.line; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(0, sy(0)); ctx.lineTo(w, sy(0)); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = COL.green; ctx.lineWidth = 2; ctx.beginPath();
  series.forEach((v, i) => (i ? ctx.lineTo(sx(i), sy(v)) : ctx.moveTo(sx(i), sy(v)))); ctx.stroke();
  const cur = series[series.length - 1], peak = Math.max(...series);
  let pk = -Infinity, dd = 0; for (const v of series) { pk = Math.max(pk, v); dd = Math.min(dd, v - pk); }
  $("#cv-peak").textContent = sign(peak); $("#cv-cur").textContent = sign(cur); $("#cv-dd").textContent = sign(dd);
  $("#cv-cur").style.color = cur >= 0 ? COL.green : COL.red;
}

// ── websocket ──
function toast(a) {
  const el = document.createElement("div");
  el.className = "toast " + a.kind;
  el.innerHTML = `<div class="tt">${a.kind} ${esc(a.symbol ? "$" + a.symbol : "")}</div><div>${esc((a.reasons || [])[0] || a.mint || "")}</div>`;
  let box = $("#toasts"); if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
  box.appendChild(el); setTimeout(() => el.remove(), 6000);
}
function connectWs() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "alert") {
      const a = m.data; a.kind = a.kind || a.verdict;
      STATE.signals.push({ ...a, verdict: a.kind });
      if (STATE.signals.length > 200) STATE.signals.shift();
      pushNode(a);
      if (["BUY_STRONG", "BUY_SMALL", "SELL_TRIM", "SELL_EXIT_NOW"].includes(a.kind)) toast(a);
      drawCandles(); drawBars();
    }
  };
  ws.onclose = () => setTimeout(connectWs, 2500);
}

// ── config overlay ──
const CFG_FIELDS = [
  { k: "walletAddress", label: "public wallet address", t: "text", full: true },
  { k: "walletObserverEnabled", label: "wallet observer", t: "checkbox" },
  { k: "paperEnabled", label: "paper trading", t: "checkbox" },
  { k: "paperStartingBalanceSol", label: "paper start (SOL)", t: "number" },
  { k: "minConviction", label: "min conviction notify", t: "number" },
  { k: "riskMode", label: "risk mode", t: "select", opts: ["microfish", "fixed"] },
  { k: "heliusApiKey", label: "helius key", t: "secret" },
  { k: "anthropicApiKey", label: "anthropic key", t: "secret" },
  { k: "rugcheckApiKey", label: "rugcheck key", t: "secret" },
];
async function openConfig() {
  const s = await api("/settings");
  const form = $("#cfgform");
  form.innerHTML = CFG_FIELDS.map((f) => {
    const v = s[f.k];
    if (f.t === "checkbox") return `<label class="full"><input type="checkbox" name="${f.k}" ${v ? "checked" : ""}/> ${f.label}</label>`;
    if (f.t === "select") return `<label>${f.label}<select name="${f.k}">${f.opts.map((o) => `<option ${o === v ? "selected" : ""}>${o}</option>`).join("")}</select></label>`;
    if (f.t === "secret") return `<label>${f.label} ${v ? "✓" : ""}<input type="password" name="${f.k}" placeholder="${v ? "•••• (keep)" : "not set"}"/></label>`;
    return `<label class="${f.full ? "full" : ""}">${f.label}<input type="${f.t}" name="${f.k}" value="${esc(v ?? "")}"/></label>`;
  }).join("") + `<div class="cfgrow"><button class="btn" type="button" id="cfg-save">Save</button><button class="btn ghost" type="button" id="cfg-test">Test wallet</button><button class="btn danger" type="button" id="cfg-reset">Reset paper</button><span class="muted" id="cfg-out"></span></div>`;
  $("#cfg-save").onclick = saveConfig;
  $("#cfg-test").onclick = async () => { $("#cfg-out").textContent = "testing…"; const r = await api("/settings/test-connection", { method: "POST", body: { address: form.walletAddress.value } }); $("#cfg-out").textContent = r.ok ? `OK · ${r.balanceSol?.toFixed(3)} SOL` : `fail: ${r.error}`; };
  $("#cfg-reset").onclick = async () => { await api("/paper/reset", { method: "POST" }); $("#cfg-out").textContent = "paper reset"; loadAll(); };
  $("#config").classList.add("open");
}
async function saveConfig() {
  const form = $("#cfgform"); const out = {};
  for (const f of CFG_FIELDS) {
    const el = form[f.k]; if (!el) continue;
    if (f.t === "checkbox") out[f.k] = el.checked;
    else if (f.t === "number") { if (el.value !== "") out[f.k] = Number(el.value); }
    else if (f.t === "secret") { if (el.value !== "") out[f.k] = el.value; }
    else out[f.k] = el.value;
  }
  const r = await api("/settings", { method: "PUT", body: out });
  $("#cfg-out").textContent = r.ok ? "saved" : "error";
  loadAll();
}
$("#open-config").onclick = openConfig;
$("#close-config").onclick = () => $("#config").classList.remove("open");
$("#aiform").onsubmit = async (e) => {
  e.preventDefault();
  const mint = e.target.mint.value.trim();
  $("#ai-out").textContent = "queued…";
  const r = await api("/ai-computer/task", { method: "POST", body: { mint } });
  $("#ai-out").textContent = r.ok ? `running ${r.taskId}` : `error: ${r.error}`;
};

// ── boot ──
(async function boot() {
  await loadAll();
  drawGraph();
  connectWs();
  setInterval(loadAll, 15000); // refresh stats/curve periodically
  window.addEventListener("resize", () => { drawCandles(); drawBars(); drawCurve(); });
})();
