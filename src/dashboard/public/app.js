"use strict";
// MICROFISH RISK ENGINE — terminal layout, real data, dependency-free canvas.
// Cream/pixel art style kept; layout mirrors the reference. No fabricated data:
// panels only show what the engine actually produces.

const $ = (s, r = document) => r.querySelector(s);
const api = async (p, o) =>
  (await fetch(`/api${p}`, { headers: { "Content-Type": "application/json" }, ...o, body: o && o.body ? JSON.stringify(o.body) : undefined })).json();
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sign = (n, d = 2) => (n >= 0 ? "+" : "") + Number(n || 0).toFixed(d);
const pctS = (n) => (n >= 0 ? "+" : "") + Math.round(n || 0) + "%";
const commas = (n) => Number(n || 0).toLocaleString();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

const COL = { paper: "#f6f2e6", ink: "#21241d", green: "#2f8f4e", greenB: "#3aa85c", red: "#cf4b41", gold: "#c98a2b", blue: "#3f6fb0", muted: "#9a9886", line: "#d4ccb4" };
const VC = { BUY_STRONG: COL.greenB, BUY_SMALL: COL.green, WATCH_ONLY: COL.muted, TOO_LATE: COL.gold, AVOID: COL.red, SELL_TRIM: COL.gold, SELL_EXIT_NOW: COL.red };
const vcol = (v) => VC[v] || COL.muted;
const isBuy = (v) => v === "BUY_SMALL" || v === "BUY_STRONG";

const STATE = { signals: [], status: null, stats: null, paper: null, market: null, council: null, bootAt: Date.now() };

// ── clock + uptime ──
function tick() {
  const d = new Date();
  $("#t-clock").textContent = d.toISOString().slice(11, 19);
  const up = Math.floor((Date.now() - STATE.bootAt) / 1000);
  const hh = String(Math.floor(up / 3600)).padStart(2, "0"), mm = String(Math.floor((up % 3600) / 60)).padStart(2, "0"), ss = String(up % 60).padStart(2, "0");
  $("#ls-timer").textContent = `${hh}:${mm}:${ss}`;
}
setInterval(tick, 1000); tick();

// ── canvas helpers ──
function fit(cv, cssH) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 300;
  cv.style.height = cssH + "px"; cv.width = Math.max(1, Math.floor(w * dpr)); cv.height = Math.floor(cssH * dpr);
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, cssH);
  return { ctx, w, h: cssH };
}
function sparkline(id, vals, color) {
  const cv = $(id); if (!cv) return; const { ctx, w, h } = fit(cv, 26);
  if (vals.length < 2) return;
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
  vals.forEach((v, i) => { const x = (i / (vals.length - 1)) * w, y = h - 2 - ((v - min) / (max - min || 1)) * (h - 4); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
}

// ── data ──
const counters = () => (STATE.status && STATE.status.metrics && STATE.status.metrics.counters) || {};
const timings = () => (STATE.status && STATE.status.metrics && STATE.status.metrics.timings) || {};
const byV = () => (STATE.stats && STATE.stats.byVerdict) || {};
const buySignals = () => (byV().BUY_SMALL || 0) + (byV().BUY_STRONG || 0);
const resolved = () => STATE.signals.filter((s) => s.maxGainPct != null);
const topSignal = () => { const b = STATE.signals.filter((s) => isBuy(s.verdict)); return (b.length ? b : STATE.signals).slice().sort((a, z) => z.conviction - a.conviction)[0]; };

async function loadAll() {
  const [status, stats, paper, signals, market, council] = await Promise.all([
    api("/status").catch(() => null), api("/journal/stats").catch(() => null), api("/paper").catch(() => null),
    api("/signals?limit=150").catch(() => []), api("/market").catch(() => null), api("/ai-computer/latest").catch(() => null),
  ]);
  STATE.status = status; STATE.stats = stats; STATE.paper = paper; STATE.market = market; STATE.council = council;
  STATE.signals = (signals || []).map((s) => ({ ...s, verdict: s.verdict })).reverse();
  renderTiles(); renderBestCall(); renderWeather(); renderSources(); renderCouncil();
  renderFeed(); renderStats(); renderEvidence(); renderAlerts(); drawCurve();
}

// buckets a metric from recent signals into n time slots
function buckets(pred, n = 14) {
  const s = STATE.signals; if (!s.length) return [];
  const per = Math.max(1, Math.ceil(s.length / n)); const out = [];
  for (let i = 0; i < s.length; i += per) out.push(s.slice(i, i + per).filter(pred).length);
  return out;
}

function renderTiles() {
  const c = counters(), st = STATE.stats || {}, co = (STATE.status && STATE.status.counts) || {};
  const winners = resolved().filter((x) => x.maxGainPct >= 100).length;
  const rugs = (byV().AVOID || 0);
  $("#tile-scanned").textContent = commas(co.tokens || c.tokens_seen || 0);
  $("#tile-winners").textContent = commas(winners);
  $("#tile-rugs").textContent = commas(rugs);
  $("#tile-early").textContent = commas(buySignals());
  $("#td-scanned").textContent = `↑ ${commas(c.tokens_seen || 0)} session`;
  $("#td-winners").textContent = `${Math.round((st.winRate || 0) * 100)}% hit ≥2x`;
  $("#td-rugs").textContent = `↑ ${commas(c.avoided || 0)} session`;
  $("#td-early").textContent = `↑ ${commas((c.scored_BUY_SMALL || 0) + (c.scored_BUY_STRONG || 0))} session`;
  sparkline("#sp-scanned", buckets(() => true), COL.green);
  sparkline("#sp-winners", buckets((x) => x.maxGainPct >= 100), COL.green);
  sparkline("#sp-rugs", buckets((x) => x.verdict === "AVOID"), COL.red);
  sparkline("#sp-early", buckets((x) => isBuy(x.verdict)), COL.gold);
}

function renderBestCall() {
  let bc = null; for (const s of STATE.signals) if (s.maxGainPct != null && (!bc || s.maxGainPct > bc.maxGainPct)) bc = s;
  if (!bc) { $("#bc-token").textContent = "—"; $("#bc-gain").textContent = "—"; $("#bc-conf").textContent = "—"; $("#bc-detect").textContent = "no resolved signals yet"; return; }
  $("#bc-token").innerHTML = `$${esc(bc.symbol || bc.mint.slice(0, 8))} <span class="muted small">${bc.verdict}</span>`;
  const x = 1 + bc.maxGainPct / 100;
  $("#bc-gain").innerHTML = `${pctS(bc.maxGainPct)} <span class="muted small">${x.toFixed(1)}x</span>`;
  $("#bc-conf").textContent = Math.round(bc.conviction) + "%";
  $("#bc-detect").textContent = `risk ${bc.riskTier || "—"} · max drawdown ${bc.maxDrawdownPct != null ? Math.round(bc.maxDrawdownPct) + "%" : "—"}`;
}

function renderWeather() {
  const m = STATE.market || {}, wx = m.weather || "NEUTRAL";
  const el = $("#wx-state"); el.textContent = wx; el.className = "wx-state wx-" + wx;
  $("#wx-sol").innerHTML = m.solChange24h != null ? `<span class="${m.solChange24h >= 0 ? "green" : "red"}">${pctS(m.solChange24h)}</span>` : "—";
  $("#wx-btc").innerHTML = m.btcChange24h != null ? `<span class="${m.btcChange24h >= 0 ? "green" : "red"}">${pctS(m.btcChange24h)}</span>` : "—";
  const rate = STATE.signals.length >= 2 ? ((STATE.signals.length / Math.max((STATE.signals[STATE.signals.length - 1].at - STATE.signals[0].at) / 60000, 1))).toFixed(1) : "0";
  $("#wx-meme").textContent = rate + "/min";
  $("#wx-new").textContent = commas(counters().tokens_seen || 0);
  $("#feed-rate").textContent = rate + "/min";
}

function srcIcon(v) { return v >= 66 ? `<b class="ok">✓ ${v >= 80 ? "STRONG" : "GOOD"}</b>` : v >= 40 ? `<b class="warn">△ FAIR</b>` : `<b class="part">○ WEAK</b>`; }
function renderSources() {
  const t = topSignal(); const sc = (t && t.scores) || {};
  const rows = [["RugCheck / Safety", sc.safety], ["Trade Flow / Organic", sc.organic], ["Momentum", sc.momentum], ["Dev Wallet", sc.devReputation], ["Smart Money", sc.smartMoney], ["Narrative", sc.hype]];
  $("#src-list").innerHTML = rows.map(([k, v]) => `<div class="srcline"><span>${k}</span>${v != null ? srcIcon(Math.round(v)) : "<b class='muted'>—</b>"}</div>`).join("");
  $("#src-score").textContent = t && t.sourceAgreement != null ? Math.round(t.sourceAgreement) + "%" : "—";
}

function renderCouncil() {
  const c = STATE.council && STATE.council.council;
  const claude = c ? `<b class="${c.recommendation === "confirm" ? "ok" : "warn"}">${c.recommendation === "confirm" ? "BULLISH" : "CAUTION"}</b>` : `<b class="muted">off</b>`;
  const rows = [["Claude (Haiku)", claude], ["GPT-4o", "<b class='muted'>not wired</b>"], ["Gemini", "<b class='muted'>not wired</b>"], ["Perplexity", "<b class='muted'>not wired</b>"]];
  $("#council-list").innerHTML = rows.map(([k, v]) => `<div class="council-row"><span class="muted small">${k}</span>${v}</div>`).join("") +
    `<div class="sec-label">CONSENSUS</div><div class="bignum sm" style="color:${c ? COL.green : COL.muted}">${c ? c.score + "%" : "—"}</div>` +
    (c ? `<div class="muted small" style="margin-top:6px">${esc(c.rationale).slice(0, 90)}</div>` : `<div class="muted small">run AI research in CONFIG →</div>`);
}

function ageStr(at) { const s = Math.floor((Date.now() - at) / 1000); return s < 60 ? `00m ${String(s).padStart(2, "0")}s` : `${String(Math.floor(s / 60)).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`; }
function feedRow(s) {
  const l = s.links || {}, mom = Math.round(s.scores.momentum), org = Math.round(s.scores.organic), risk = Math.round(s.scores.lateEntryRisk), conf = Math.round(s.conviction);
  return `<tr>
    <td><b>$${esc(s.symbol || s.mint.slice(0, 5))}</b>${l.dexscreener ? ` <a class="small" href="${l.dexscreener}" target="_blank" rel="noopener">↗</a>` : ""}</td>
    <td class="muted">${ageStr(s.at)}</td>
    <td><span class="pressure"><i style="width:${mom}%;background:${mom >= 60 ? COL.green : mom >= 35 ? COL.gold : COL.red}"></i></span> ${mom}%</td>
    <td style="color:${org >= 55 ? COL.green : org >= 45 ? COL.gold : COL.red}">${org}%</td>
    <td style="color:${risk >= 60 ? COL.red : risk >= 40 ? COL.gold : COL.green}">${risk}</td>
    <td>${conf}%</td>
    <td><span class="chip" style="background:${vcol(s.verdict)}">${s.verdict}</span></td>
  </tr>`;
}
function renderFeed() {
  const rows = STATE.signals.slice(-14).reverse();
  $("#feed").innerHTML = rows.length ? rows.map(feedRow).join("") : `<tr><td colspan="7" class="muted">waiting for signals…</td></tr>`;
}

function renderStats() {
  const st = STATE.stats || {}, c = counters(), co = (STATE.status && STATE.status.counts) || {};
  const res = resolved(), buysRes = res.filter((x) => isBuy(x.verdict)), nonBuyRes = res.filter((x) => !isBuy(x.verdict));
  const falseBuy = buysRes.length ? (buysRes.filter((x) => x.maxGainPct < 10).length / buysRes.length) * 100 : 0;
  const missed = nonBuyRes.length ? (nonBuyRes.filter((x) => x.maxGainPct >= 100).length / nonBuyRes.length) * 100 : 0;
  const avgConf = STATE.signals.length ? STATE.signals.reduce((a, s) => a + s.conviction, 0) / STATE.signals.length : 0;
  const avoidRate = (st.total || 0) ? ((byV().AVOID || 0) / st.total) * 100 : 0;
  const p50 = timings().stage0_ms ? Math.round(timings().stage0_ms.p50) : null;
  const rows = [
    ["Win Rate (≥2x)", Math.round((st.winRate || 0) * 100) + "%", COL.green],
    ["Avoid Rate", Math.round(avoidRate) + "%", COL.ink],
    ["False Buy", falseBuy.toFixed(1) + "%", COL.red],
    ["Missed (≥2x in AVOID/WATCH)", missed.toFixed(1) + "%", COL.gold],
    ["Avg Confidence", Math.round(avgConf) + "%", COL.ink],
    ["Avg Stage-0", p50 != null ? p50 + "ms" : "—", COL.ink],
    ["Signals Logged", commas(st.total || 0), COL.ink],
    ["Tokens Scanned", commas(co.tokens || 0), COL.ink],
  ];
  $("#ms-list").innerHTML = rows.map(([k, v, c2]) => `<div class="msline"><span>${k}</span><b style="color:${c2}">${v}</b></div>`).join("");
}

function evColor(v) { return v >= 66 ? COL.green : v >= 40 ? COL.gold : COL.red; }
function renderEvidence() {
  const t = topSignal(); const sc = (t && t.scores) || {};
  $("#ev-token").textContent = t ? "$" + (t.symbol || t.mint.slice(0, 6)) : "current token";
  const rows = [["Safety (RugCheck)", sc.safety], ["Organic / Trade Flow", sc.organic], ["Momentum", sc.momentum], ["Dev Wallet", sc.devReputation], ["Smart Money", sc.smartMoney], ["Narrative", sc.hype]];
  $("#ev-list").innerHTML = rows.map(([k, v]) => { const n = Math.round(v || 0); return `<div class="ev-row"><div class="evk"><span>${k}</span><span>${n}%</span></div><div class="ev-bar"><i style="width:${n}%;background:${evColor(n)}"></i></div></div>`; }).join("");
  const overall = t ? Math.round(t.conviction) : 0;
  $("#ev-overall").textContent = overall + "%";
  drawGauge(overall);
}
function drawGauge(p) {
  const cv = $("#ev-gauge"); const { ctx } = fit(cv, 120); const cx = 60, cy = 64, r = 46;
  ctx.lineWidth = 9; ctx.strokeStyle = COL.line; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
  ctx.strokeStyle = evColor(p); ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 0.75 + (Math.PI * 1.5) * (p / 100)); ctx.stroke();
}

function renderAlerts() {
  const recent = STATE.signals.slice(-8).reverse();
  const segs = recent.map((s) => `${s.verdict === "AVOID" ? "🛑" : isBuy(s.verdict) ? "🟢" : "•"} $${s.symbol || s.mint.slice(0, 5)} ${s.verdict} ${Math.round(s.conviction)}`);
  const tail = `◎ MICROFISH · READ-ONLY · NEVER SIGNS · SCANNED ${commas((STATE.status && STATE.status.counts && STATE.status.counts.tokens) || 0)}`;
  $("#alerts").textContent = ((segs.join("   ·   ") || "scanning…") + "      " + tail + "      ").repeat(2);
}

// ── confidence / accuracy curve (rolling avg conviction) ──
function drawCurve() {
  const cv = $("#curve"); const { ctx, w, h } = fit(cv, 200);
  const s = STATE.signals; if (s.length < 3) { ctx.fillStyle = COL.muted; ctx.font = "17px VT323"; ctx.fillText("accuracy builds as signals resolve…", 12, h / 2); $("#cv-today").textContent = "—"; return; }
  const n = Math.min(24, s.length), per = Math.ceil(s.length / n), pts = [];
  for (let i = 0; i < s.length; i += per) { const chunk = s.slice(i, i + per); pts.push(chunk.reduce((a, x) => a + x.conviction, 0) / chunk.length); }
  const pad = 12, max = 100, min = 0;
  const sx = (i) => pad + (i / (pts.length - 1)) * (w - pad * 2), sy = (v) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
  ctx.strokeStyle = COL.line; ctx.setLineDash([3, 3]);[25, 50, 75].forEach((g) => { ctx.beginPath(); ctx.moveTo(0, sy(g)); ctx.lineTo(w, sy(g)); ctx.stroke(); }); ctx.setLineDash([]);
  ctx.strokeStyle = COL.blue; ctx.lineWidth = 2; ctx.beginPath();
  pts.forEach((v, i) => (i ? ctx.lineTo(sx(i), sy(v)) : ctx.moveTo(sx(i), sy(v)))); ctx.stroke();
  $("#cv-today").textContent = "now " + Math.round(pts[pts.length - 1]) + "%";
}

// ── entity relationship graph (top token) ──
let graphCv, wob = 0;
function entitiesFor(t) {
  if (!t) return [];
  const f = [...(t.redFlags || []), ...(t.flags || [])].join(" ").toLowerCase();
  const ents = [];
  ents.push({ label: "DEV WALLET", color: COL.blue, sub: /dev-sold|dev wallet sold/.test(f) ? "sold" : "holding" });
  ents.push({ label: "ORGANIC BUYERS", color: COL.green, sub: Math.round(t.scores.organic) + "% organic" });
  if (t.scores.smartMoney >= 55) ents.push({ label: "SMART MONEY", color: COL.blue, sub: "tracked" });
  if (/bundle/.test(f)) ents.push({ label: "BUNDLE / SNIPER", color: COL.red, sub: "detected" });
  if (/rug/.test(f)) ents.push({ label: "KNOWN RUG", color: COL.red, sub: "fingerprint match" });
  if (/safety-unknowns/.test(f)) ents.push({ label: "UNVERIFIED", color: COL.muted, sub: "unknowns" });
  if (t.scores.momentum >= 60) ents.push({ label: "BUYER VELOCITY", color: COL.gold, sub: "rising" });
  return ents;
}
function drawGraph() {
  if (!graphCv) graphCv = $("#graph");
  const { ctx, w, h } = fit(graphCv, 320);
  const t = topSignal();
  const cx = w / 2, cy = h / 2; wob += 0.012;
  const ents = entitiesFor(t);
  $("#graph-stats").textContent = t ? `nodes ${ents.length + 1} · ${esc(t.symbol || "?")}` : "nodes 0";
  $("#legend").innerHTML = [["TOKEN", COL.green], ["DEV", COL.blue], ["ORGANIC", COL.green], ["SMART MONEY", COL.blue], ["WHALE / VELOCITY", COL.gold], ["RUG / SNIPER", COL.red], ["UNVERIFIED", COL.muted]]
    .map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join("");
  // edges + nodes
  ents.forEach((e, i) => {
    const ang = (i / ents.length) * Math.PI * 2 + wob;
    const R = 105 + Math.sin(wob * 2 + i) * 6;
    e.x = cx + Math.cos(ang) * R; e.y = cy + Math.sin(ang) * (R * 0.62);
    ctx.strokeStyle = "rgba(120,120,90,0.3)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(e.x, e.y); ctx.stroke();
  });
  ents.forEach((e) => {
    ctx.beginPath(); ctx.arc(e.x, e.y, 7, 0, 7); ctx.fillStyle = e.color; ctx.fill();
    ctx.fillStyle = COL.ink; ctx.font = "13px VT323"; ctx.textAlign = "center";
    ctx.fillText(e.label, e.x, e.y - 11); ctx.fillStyle = COL.muted; ctx.fillText(e.sub, e.x, e.y + 20);
  });
  // center token
  ctx.beginPath(); ctx.arc(cx, cy, t ? 13 : 8, 0, 7); ctx.fillStyle = t ? vcol(t.verdict) : COL.muted; ctx.fill();
  ctx.strokeStyle = COL.ink; ctx.lineWidth = 2; ctx.stroke();
  if (t) { ctx.fillStyle = COL.ink; ctx.font = "15px VT323"; ctx.textAlign = "center"; ctx.fillText("$" + (t.symbol || t.mint.slice(0, 5)), cx, cy + 32); }
  requestAnimationFrame(drawGraph);
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
  ws.onopen = () => ($("#sys").className = "green", ($("#sys").textContent = "● ONLINE"));
  ws.onclose = () => { $("#sys").className = "red"; $("#sys").textContent = "● OFFLINE"; setTimeout(connectWs, 2500); };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "alert") {
      const a = m.data; a.verdict = a.kind || a.verdict;
      STATE.signals.push(a); if (STATE.signals.length > 250) STATE.signals.shift();
      renderFeed(); renderAlerts();
      if (isBuy(a.verdict) || a.verdict === "SELL_TRIM" || a.verdict === "SELL_EXIT_NOW") toast(a);
    }
  };
}

// ── config overlay ──
const CFG = [
  { k: "walletAddress", label: "public wallet address", t: "text", full: true },
  { k: "walletObserverEnabled", label: "wallet observer", t: "checkbox" },
  { k: "paperEnabled", label: "paper trading", t: "checkbox" },
  { k: "paperStartingBalanceSol", label: "paper start (SOL)", t: "number" },
  { k: "minConviction", label: "min conviction notify", t: "number" },
  { k: "riskMode", label: "risk mode", t: "select", opts: ["microfish", "fixed"] },
  { k: "heliusApiKey", label: "helius key", t: "secret" },
  { k: "anthropicApiKey", label: "anthropic key (council)", t: "secret" },
  { k: "rugcheckApiKey", label: "rugcheck key", t: "secret" },
];
async function openConfig() {
  const s = await api("/settings"); const form = $("#cfgform");
  form.innerHTML = CFG.map((f) => {
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
  for (const f of CFG) { const el = form[f.k]; if (!el) continue;
    if (f.t === "checkbox") out[f.k] = el.checked; else if (f.t === "number") { if (el.value !== "") out[f.k] = Number(el.value); }
    else if (f.t === "secret") { if (el.value !== "") out[f.k] = el.value; } else out[f.k] = el.value; }
  const r = await api("/settings", { method: "PUT", body: out }); $("#cfg-out").textContent = r.ok ? "saved" : "error"; loadAll();
}
$("#open-config").onclick = openConfig;
$("#close-config").onclick = () => $("#config").classList.remove("open");
$("#aiform").onsubmit = async (e) => { e.preventDefault(); const mint = e.target.mint.value.trim(); $("#ai-out").textContent = "queued…"; const r = await api("/ai-computer/task", { method: "POST", body: { mint } }); $("#ai-out").textContent = r.ok ? `running ${r.taskId} — check Council shortly` : `error: ${r.error}`; };

(async function boot() {
  await loadAll(); drawGraph(); connectWs();
  setInterval(loadAll, 12000);
  window.addEventListener("resize", () => { renderTiles(); drawCurve(); renderEvidence(); });
})();
