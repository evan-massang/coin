"use strict";
// MEMEFISH terminal — single-screen, real data, dependency-free canvas viz.
// Content reframed for a READ-ONLY meme-coin SIGNAL scanner (not a whale trader).

const $ = (s, r = document) => r.querySelector(s);
const api = async (p, o) =>
  (await fetch(`/api${p}`, { headers: { "Content-Type": "application/json" }, ...o, body: o && o.body ? JSON.stringify(o.body) : undefined })).json();
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sign = (n, d = 2) => (n >= 0 ? "+" : "") + Number(n || 0).toFixed(d);
const pct = (n) => (n >= 0 ? "+" : "") + Math.round(n || 0) + "%";
const commas = (n) => Number(n || 0).toLocaleString();

const COL = { paper: "#f6f2e6", ink: "#21241d", green: "#2f8f4e", greenB: "#3aa85c", red: "#cf4b41", gold: "#c98a2b", muted: "#9a9886", line: "#d4ccb4" };
const VC = { BUY_STRONG: COL.greenB, BUY_SMALL: COL.green, WATCH_ONLY: COL.muted, TOO_LATE: COL.gold, AVOID: COL.red, SELL_TRIM: COL.gold, SELL_EXIT_NOW: COL.red };
const vcol = (v) => VC[v] || COL.muted;
const isBuy = (v) => v === "BUY_SMALL" || v === "BUY_STRONG";

const STATE = { signals: [], nodes: [], paper: null, stats: null, status: null };

function tick() { $("#t-clock").textContent = new Date().toISOString().slice(11, 19); }
setInterval(tick, 1000); tick();

function fit(cv, cssH) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 600;
  cv.style.height = cssH + "px"; cv.width = Math.max(1, Math.floor(w * dpr)); cv.height = Math.floor(cssH * dpr);
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, cssH);
  return { ctx, w, h: cssH };
}

async function loadAll() {
  const [status, stats, paper, signals] = await Promise.all([
    api("/status").catch(() => null), api("/journal/stats").catch(() => null),
    api("/paper").catch(() => null), api("/signals?limit=150").catch(() => []),
  ]);
  STATE.status = status; STATE.stats = stats; STATE.paper = paper;
  STATE.signals = (signals || []).map((s) => ({ ...s, kind: s.verdict })).reverse(); // oldest→newest
  buildNodes(); renderHero(); renderTopPanel(); renderTape(); renderFunnel(); renderWeather(); renderPerf(); renderMarquee(); drawBars(); drawCurve();
}

const counters = () => (STATE.status && STATE.status.metrics && STATE.status.metrics.counters) || {};
const buySignals = () => { const b = (STATE.stats && STATE.stats.byVerdict) || {}; return (b.BUY_SMALL || 0) + (b.BUY_STRONG || 0); };
function ratePerMin() {
  const s = STATE.signals; if (s.length < 2) return s.length;
  const mins = Math.max((s[s.length - 1].at - s[0].at) / 60000, 1); return (s.length / mins).toFixed(1);
}
function bestCatch() {
  let best = null;
  for (const s of STATE.signals) if (s.maxGainPct != null && (!best || s.maxGainPct > best.maxGainPct)) best = s;
  return best;
}
function latestWeather() {
  for (let i = STATE.signals.length - 1; i >= 0; i--) if (STATE.signals[i].marketWeather) return STATE.signals[i];
  return null;
}

function renderHero() {
  const st = STATE.stats || {}, c = (STATE.status && STATE.status.counts) || {};
  $("#hero-num").textContent = commas(c.tokens || counters().tokens_seen || 0);
  const hit = Math.round((st.winRate || 0) * 100);
  $("#hero-sub").innerHTML = `${counters().survivors || 0} survived · ${buySignals()} buy signals · <b class="green">${hit}% hit ≥2x</b>`;
  const w = (STATE.status && STATE.status.wallet) || {};
  $("#t-wallet").textContent = w.address ? w.address.slice(0, 6) + "…" + w.address.slice(-6) : "no wallet";
  $("#hero-mode").textContent = (STATE.status && STATE.status.modes && STATE.status.modes.paperTrading) ? "● PAPER ON" : "● SIGNALS";
  $("#hero-dots").innerHTML = STATE.signals.slice(-44).map((s) => `<i style="background:${vcol(s.verdict)}"></i>`).join("");
  const bc = bestCatch();
  $("#catch-big").innerHTML = bc ? `<span class="green">${pct(bc.maxGainPct)}</span>` : "—";
  $("#catch-sub").textContent = bc ? `$${bc.symbol || bc.mint.slice(0, 6)} · peak after signal` : "no resolved signals yet";
}

function renderTopPanel() {
  const buys = STATE.signals.filter((s) => isBuy(s.verdict));
  const top = (buys.length ? buys : STATE.signals).slice().sort((a, b) => b.conviction - a.conviction)[0];
  const set = (id, v) => ($(id).textContent = v);
  if (!top) { ["#tp-sym", "#tp-verdict", "#tp-conv", "#tp-safety", "#tp-mom", "#tp-risk"].forEach((i) => set(i, "—")); return; }
  set("#tp-sym", "$" + (top.symbol || top.mint.slice(0, 6)));
  $("#tp-verdict").textContent = top.verdict; $("#tp-verdict").style.color = vcol(top.verdict);
  set("#tp-conv", Math.round(top.conviction)); set("#tp-safety", Math.round(top.scores.safety));
  set("#tp-mom", Math.round(top.scores.momentum)); set("#tp-risk", top.riskTier || "—");
  const rf = (top.redFlags && top.redFlags[0]) || (top.flags && top.flags[0]) || "";
  $("#tp-flag").textContent = rf ? "⚠ " + rf : "";
  $("#legend").innerHTML = [["BUY", COL.greenB], ["WATCH", COL.muted], ["AVOID", COL.red], ["SELL", COL.gold]]
    .map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join("");
  $("#t-weather").textContent = (latestWeather() || {}).marketWeather || "—";
}

function tapeRow(s) {
  const l = s.links || {};
  return `<div class="tape-row">
    <span class="chip" style="background:${vcol(s.verdict)}">${s.verdict}</span>
    <span class="tape-sym">$${esc(s.symbol || s.mint.slice(0, 5))}</span>
    <span class="tape-sc">conv ${Math.round(s.conviction)} · saf ${Math.round(s.scores.safety)} · mom ${Math.round(s.scores.momentum)} · ${s.riskTier || "—"}${s.redFlags && s.redFlags[0] ? " · ⚠ " + esc(s.redFlags[0]) : ""}</span>
    <span class="tape-links">${l.dexscreener ? `<a href="${l.dexscreener}" target="_blank" rel="noopener">DEX</a>` : ""}${l.jupiter ? `<a href="${l.jupiter}" target="_blank" rel="noopener">JUP</a>` : ""}${l.rugcheck ? `<a href="${l.rugcheck}" target="_blank" rel="noopener">RUG</a>` : ""}</span>
  </div>`;
}
function renderTape() {
  const rows = STATE.signals.slice(-40).reverse();
  $("#tape").innerHTML = rows.length ? rows.map(tapeRow).join("") : `<div class="tape-empty">waiting for signals…</div>`;
  $("#tape-rate").textContent = ratePerMin() + "/min";
}

function renderFunnel() {
  const c = counters();
  const scanned = c.tokens_seen || 0, surv = c.survivors || 0, avoided = c.avoided || 0;
  const buy = (c.scored_BUY_SMALL || 0) + (c.scored_BUY_STRONG || 0);
  const base = Math.max(scanned, 1);
  const rows = [
    ["SCANNED", scanned, COL.muted], ["STAGE-0 PASS", surv, COL.green],
    ["STAGE-0 AVOID", avoided, COL.red], ["BUY SIGNALS", buy, COL.greenB],
  ];
  $("#funnel").innerHTML = rows.map(([k, v, col]) =>
    `<div class="fn-row"><div class="fn-head">${k}<b>${commas(v)}</b></div><div class="fn-bar"><i style="width:${Math.min(100, (v / base) * 100)}%;background:${col}"></i></div></div>`).join("");
}

function renderWeather() {
  const w = latestWeather();
  const wx = (w && w.marketWeather) || "NEUTRAL";
  const t = (STATE.status && STATE.status.metrics && STATE.status.metrics.timings) || {};
  const p50 = t.stage0_ms ? Math.round(t.stage0_ms.p50) + "ms" : "—";
  const wsLive = !!window.__wsLive;
  const lines = [
    ["market weather", `<b style="color:${wx === "RISK_ON" ? COL.green : wx === "RISK_OFF" ? COL.red : COL.gold}">${wx}</b>`],
    ["source agreement", w && w.sourceAgreement != null ? Math.round(w.sourceAgreement) : "—"],
    ["stage-0 latency", `${p50} <span class="muted">p50</span>`],
    ["scan rate", ratePerMin() + "/min"],
    ["feed", wsLive ? `<b class="green">LIVE</b>` : `<b class="red">DOWN</b>`],
  ];
  $("#weather").innerHTML =
    `<div class="wx-state wx-${wx}">${wx}</div>` +
    lines.map(([k, v]) => `<div class="wxline"><span>${k}</span><b>${v}</b></div>`).join("");
}

function renderPerf() {
  const st = STATE.stats || {}, c = counters();
  $("#perf-hit").textContent = Math.round((st.winRate || 0) * 100) + "%";
  $("#st-scanned").textContent = commas((STATE.status && STATE.status.counts && STATE.status.counts.tokens) || c.tokens_seen || 0);
  const survPct = c.tokens_seen ? Math.round((c.survivors / c.tokens_seen) * 100) : 0;
  $("#st-surv").textContent = survPct + "%";
  $("#st-buy").textContent = buySignals();
  $("#st-avg").textContent = pct(st.avgMaxGainPct || 0);
}

function renderMarquee() {
  const st = STATE.stats || {}, c = counters(), bc = bestCatch();
  const seg = `SCANNED ${commas((STATE.status && STATE.status.counts && STATE.status.counts.tokens) || 0)}  ·  SURVIVED ${commas(c.survivors || 0)}  ·  BUY SIGNALS ${buySignals()}  ·  HIT RATE ${Math.round((st.winRate || 0) * 100)}%  ·  BEST CATCH ${bc ? pct(bc.maxGainPct) + " $" + (bc.symbol || "") : "—"}  ·  WEATHER ${(latestWeather() || {}).marketWeather || "—"}  ·  ◎ MEMEFISH · READ-ONLY · NEVER SIGNS`;
  $("#marquee").textContent = (seg + "      ").repeat(2);
}

// ── relationship graph ──
function buildNodes() {
  const recent = STATE.signals.slice(-44);
  STATE.nodes = recent.map((s, i) => {
    const prev = STATE.nodes.find((n) => n.mint === s.mint);
    return { mint: s.mint, verdict: s.verdict, r: 3 + (s.conviction / 100) * 7,
      x: prev ? prev.x : 270 + Math.cos(i) * (40 + (i % 7) * 14), y: prev ? prev.y : 145 + Math.sin(i * 1.3) * (30 + (i % 5) * 12), vx: 0, vy: 0 };
  });
}
function pushNode(s) {
  STATE.nodes.push({ mint: s.mint, verdict: s.verdict, r: 3 + (s.conviction / 100) * 7, x: 270 + (Math.random() * 40 - 20), y: 145 + (Math.random() * 40 - 20), vx: 0, vy: 0 });
  if (STATE.nodes.length > 44) STATE.nodes.shift();
}
function stepGraph(w, h) {
  const ns = STATE.nodes, cx = w / 2, cy = h / 2;
  for (let i = 0; i < ns.length; i++) {
    const a = ns[i]; a.vx += (cx - a.x) * 0.0009; a.vy += (cy - a.y) * 0.0009;
    for (let j = i + 1; j < ns.length; j++) {
      const b = ns[j]; let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || 1, d = Math.sqrt(d2), f = 240 / d2;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
  }
  for (let i = 1; i < ns.length; i++) {
    const a = ns[i - 1], b = ns[i], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, k = (d - 46) * 0.01;
    a.vx += (dx / d) * k; a.vy += (dy / d) * k; b.vx -= (dx / d) * k; b.vy -= (dy / d) * k;
  }
  for (const a of ns) { a.vx *= 0.86; a.vy *= 0.86; a.x = Math.max(a.r + 2, Math.min(w - a.r - 2, a.x + a.vx)); a.y = Math.max(a.r + 2, Math.min(h - a.r - 2, a.y + a.vy)); }
}
let graphCv;
function drawGraph() {
  if (!graphCv) graphCv = $("#graph");
  const { ctx, w, h } = fit(graphCv, 290); stepGraph(w, h);
  const ns = STATE.nodes;
  ctx.strokeStyle = "rgba(120,120,90,0.25)"; ctx.lineWidth = 1;
  for (let i = 1; i < ns.length; i++) { ctx.beginPath(); ctx.moveTo(ns[i - 1].x, ns[i - 1].y); ctx.lineTo(ns[i].x, ns[i].y); ctx.stroke(); }
  for (const a of ns) { ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, 7); ctx.fillStyle = vcol(a.verdict); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.stroke(); }
  $("#graph-stats").textContent = `nodes ${ns.length}`;
  requestAnimationFrame(drawGraph);
}

// ── last-30 call outcomes (max gain % after each signal) ──
function drawBars() {
  const cv = $("#bars"); const { ctx, w, h } = fit(cv, 110);
  const resolved = STATE.signals.filter((s) => s.maxGainPct != null).slice(-30);
  if (resolved.length < 2) { ctx.fillStyle = COL.muted; ctx.font = "16px VT323"; ctx.fillText("awaiting call outcomes (≈1h each)…", 10, h / 2); return; }
  const pad = 4, bw = (w - pad * 2) / resolved.length, capG = 300;
  resolved.forEach((x, i) => {
    const g = Math.max(0, Math.min(x.maxGainPct, capG));
    const bh = (g / capG) * (h - 8);
    ctx.fillStyle = x.maxGainPct >= 100 ? COL.greenB : x.maxGainPct > 10 ? COL.green : COL.red;
    ctx.fillRect(pad + i * bw + 1, h - bh - 2, Math.max(1, bw - 2), Math.max(2, bh));
  });
}

// ── equity curve: real paper, else hypothetical "aped every BUY", else placeholder ──
function drawCurve() {
  const cv = $("#curve"); const { ctx, w, h } = fit(cv, 200);
  let series = [];
  const fills = (STATE.paper && STATE.paper.fills) || [];
  if (fills.length >= 2) {
    const ordered = [...fills].reverse(); let acc = 0; series = ordered.map((f) => (acc += f.realizedPnlSol || 0));
    $("#curve-window").textContent = "paper · SOL";
  } else {
    let acc = 0; const pts = [];
    for (const s of STATE.signals) if (isBuy(s.verdict) && s.maxGainPct != null) { acc += s.maxGainPct / 100; pts.push(acc); }
    series = pts; $("#curve-window").textContent = "if you aped every BUY · x";
  }
  if (series.length < 2) {
    ctx.fillStyle = COL.muted; ctx.font = "17px VT323"; ctx.fillText("enable paper trading (CONFIG) for a real curve…", 12, h / 2);
    $("#cv-peak").textContent = "—"; $("#cv-cur").textContent = "—"; $("#cv-dd").textContent = "—"; return;
  }
  const max = Math.max(...series, 0), min = Math.min(...series, 0), pad = 12;
  const sx = (i) => pad + (i / (series.length - 1)) * (w - pad * 2), sy = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
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
  const el = document.createElement("div"); el.className = "toast " + a.kind;
  el.innerHTML = `<div class="tt">${a.kind} ${esc(a.symbol ? "$" + a.symbol : "")}</div><div>${esc((a.reasons || [])[0] || a.mint || "")}</div>`;
  let box = $("#toasts"); if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
  box.appendChild(el); setTimeout(() => el.remove(), 6000);
}
function connectWs() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => (window.__wsLive = true);
  ws.onclose = () => { window.__wsLive = false; setTimeout(connectWs, 2500); };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "alert") {
      const a = m.data; a.kind = a.kind || a.verdict;
      STATE.signals.push({ ...a, verdict: a.kind }); if (STATE.signals.length > 250) STATE.signals.shift();
      pushNode(a); renderTape();
      if (isBuy(a.kind) || a.kind === "SELL_TRIM" || a.kind === "SELL_EXIT_NOW") toast(a);
    }
  };
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
  const s = await api("/settings"); const form = $("#cfgform");
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
  const form = $("#cfgform"), out = {};
  for (const f of CFG_FIELDS) { const el = form[f.k]; if (!el) continue;
    if (f.t === "checkbox") out[f.k] = el.checked;
    else if (f.t === "number") { if (el.value !== "") out[f.k] = Number(el.value); }
    else if (f.t === "secret") { if (el.value !== "") out[f.k] = el.value; }
    else out[f.k] = el.value; }
  const r = await api("/settings", { method: "PUT", body: out });
  $("#cfg-out").textContent = r.ok ? "saved" : "error"; loadAll();
}
$("#open-config").onclick = openConfig;
$("#close-config").onclick = () => $("#config").classList.remove("open");
$("#aiform").onsubmit = async (e) => {
  e.preventDefault(); const mint = e.target.mint.value.trim();
  $("#ai-out").textContent = "queued…";
  const r = await api("/ai-computer/task", { method: "POST", body: { mint } });
  $("#ai-out").textContent = r.ok ? `running ${r.taskId}` : `error: ${r.error}`;
};

(async function boot() {
  await loadAll(); drawGraph(); connectWs();
  setInterval(loadAll, 12000);
  window.addEventListener("resize", () => { drawBars(); drawCurve(); });
})();
