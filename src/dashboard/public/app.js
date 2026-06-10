"use strict";
// MIROFISH INTELLIGENCE — operator console. Answers four questions:
//   What is happening?  → engine-state tiles + observed-token table
//   Why?                → Why-this-token + Evidence Feed (bull/bear) + graph
//   How confident?      → Observation Status (coverage/confidence/age/state)
//   What evidence?      → Evidence Feed + Conflict + Observation Timeline
// Cream/pixel art style kept. No fabricated data — panels render only what the
// engine actually produced (Graph Intelligence Layer). Read-only; never signs.

const $ = (s, r = document) => r.querySelector(s);
const api = async (p, o) =>
  (await fetch(`/api${p}`, { headers: { "Content-Type": "application/json" }, ...o, body: o && o.body ? JSON.stringify(o.body) : undefined })).json();
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pctS = (n) => (n >= 0 ? "+" : "") + Math.round(n || 0) + "%";
const commas = (n) => Number(n || 0).toLocaleString();

const COL = { paper: "#f6f2e6", ink: "#21241d", green: "#2f8f4e", greenB: "#3aa85c", red: "#cf4b41", gold: "#c98a2b", blue: "#3f6fb0", muted: "#9a9886", line: "#d4ccb4" };
const VC = { BUY_STRONG: COL.greenB, BUY_SMALL: COL.green, WATCH_ONLY: COL.muted, TOO_LATE: COL.gold, AVOID: COL.red, SELL_TRIM: COL.gold, SELL_EXIT_NOW: COL.red };
const vcol = (v) => VC[v] || COL.muted;
const isBuy = (v) => v === "BUY_SMALL" || v === "BUY_STRONG";

const STATE = {
  signals: [], status: null, market: null, engine: null, council: null, councilStats: null,
  councilLive: null, selectedMint: null, selected: null, focusEntity: null, series: null, bootAt: Date.now(),
};

const ROLE_LABEL = { bull_analyst: "Bull Analyst", narrative_analyst: "Narrative Analyst", risk_analyst: "Risk Analyst", contrarian: "Contrarian", lead_reviewer: "Lead Reviewer" };

// ── clock + uptime ──
function tick() {
  const d = new Date();
  $("#t-clock").textContent = d.toISOString().slice(11, 19);
  const up = Math.floor((Date.now() - STATE.bootAt) / 1000);
  const hh = String(Math.floor(up / 3600)).padStart(2, "0"), mm = String(Math.floor((up % 3600) / 60)).padStart(2, "0"), ss = String(up % 60).padStart(2, "0");
  $("#ls-timer").textContent = `${hh}:${mm}:${ss}`;
}
setInterval(tick, 1000); tick();

function fit(cv, cssH) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 300;
  cv.style.height = cssH + "px"; cv.width = Math.max(1, Math.floor(w * dpr)); cv.height = Math.floor(cssH * dpr);
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, cssH);
  return { ctx, w, h: cssH };
}
function ageMs(ms) { const s = Math.floor(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`; }
function ageStr(at) { return ageMs(Date.now() - at); }
// AGE column (data-truth fix): show the coin's TRUE age from on-chain pair creation
// when DexScreener provided it; otherwise show signal recency, clearly marked with a
// leading ~ + tooltip so it is NEVER read as coin age. Coin age is a primary risk gate.
function ageCell(s) {
  if (typeof s.pairCreatedAt === "number" && s.pairCreatedAt > 0) {
    return `<span title="coin age — on-chain pair creation (DexScreener)">${ageStr(s.pairCreatedAt)}</span>`;
  }
  return `<span class="muted" title="last scored (recency) — true coin age unknown: no DEX pair yet">~${ageStr(s.at)}</span>`;
}

const topSignal = () => { const b = STATE.signals.filter((s) => isBuy(s.verdict)); return (b.length ? b : STATE.signals).slice().sort((a, z) => z.conviction - a.conviction)[0]; };

async function loadAll() {
  const [status, signals, market, engine, council, councilStats] = await Promise.all([
    api("/status").catch(() => null),
    api("/signals?limit=120").catch(() => []),
    api("/market").catch(() => null),
    api("/engine-state").catch(() => null),
    api("/ai-computer/latest").catch(() => null),
    api("/council/stats").catch(() => null),
  ]);
  STATE.status = status; STATE.market = market; STATE.engine = engine; STATE.council = council; STATE.councilStats = councilStats;
  STATE.signals = (signals || []).map((s) => ({ ...s, verdict: s.verdict })).reverse();
  renderEngineState(); renderRegime(); renderCouncil(); renderTable(); renderAlerts(); renderPaper(); renderReasoning();
  api("/paper/series").then((s) => { if (s && s.positions) STATE.series = s; }).catch(() => {});
  // Default selection = highest-conviction recent token.
  if (!STATE.selectedMint && STATE.signals.length) selectToken((topSignal() || STATE.signals[STATE.signals.length - 1]).mint);
  else if (STATE.selectedMint) refreshSelected();
}

// ── engine state — what the engine is doing right now ──
function renderEngineState() {
  const e = STATE.engine || {};
  $("#es-observing").textContent = commas(e.observing || 0);
  $("#es-ready").textContent = commas(e.decisionReady || 0);
  $("#es-conv").textContent = commas(e.highConviction || 0);
  $("#es-risk").textContent = commas(e.highRisk || 0);
  // Honesty banner: if nothing is clearing the BUY gate, say WHY (not a UI bug).
  const note = $("#idle-note"); if (!note) return;
  const buys = STATE.signals.filter((s) => isBuy(s.verdict)).length;
  if (buys === 0 && STATE.signals.length >= 40) {
    note.style.display = "block";
    note.innerHTML = `⚠ No BUY signals — most tokens are scored before reaching ~8 observed trades, so conviction is honestly capped to WATCH (<b>low-coverage</b>), not faked. The Paper Wallet below fills only when a BUY clears the gate — an observation-depth limit, not a UI fault. See docs/research/cycle-02.md.`;
  } else note.style.display = "none";
}

// ── market regime ──
function renderRegime() {
  const m = STATE.market || {}, rg = m.regime || { regime: m.weather || "NEUTRAL", confidence: 0, reasons: [] };
  const el = $("#rg-state"); el.textContent = (rg.regime || "NEUTRAL").replace("_", " "); el.className = "rg-state rg-" + (rg.regime || "NEUTRAL");
  $("#rg-reason").textContent = (rg.reasons || []).join(" · ") || "—";
  $("#rg-conf").textContent = rg.confidence != null ? Math.round(rg.confidence) + "%" : "—";
  $("#wx-sol").innerHTML = m.solChange24h != null ? `<span class="${m.solChange24h >= 0 ? "green" : "red"}">${pctS(m.solChange24h)}</span>` : "—";
  $("#wx-btc").innerHTML = m.btcChange24h != null ? `<span class="${m.btcChange24h >= 0 ? "green" : "red"}">${pctS(m.btcChange24h)}</span>` : "—";
  const wx = m.weather || "NEUTRAL";
  $("#wx-state").innerHTML = `<span class="${wx === "RISK_ON" ? "green" : wx === "RISK_OFF" ? "red" : "gold"}">${wx}</span>`;
  const rate = STATE.signals.length >= 2 ? (STATE.signals.length / Math.max((STATE.signals[STATE.signals.length - 1].at - STATE.signals[0].at) / 60000, 1)).toFixed(1) : "0";
  $("#feed-rate").textContent = rate + "/min";
}

// ── Council Room: specialist multi-model panel (advisory only) ──
function recBadge(rec) { const bull = rec === "confirm"; return `<span class="cm-rec ${bull ? "green" : "gold"}">${bull ? "▲ CONFIRM" : "△ CAUTION"}</span>`; }
function renderCouncil() {
  const res = STATE.council;
  const members = (res && res.members) || [];
  const consensus = res && res.consensus;
  const cs = STATE.councilStats || {};
  const statsMap = {}; for (const s of cs.stats || []) statsMap[s.memberId] = s;
  $("#open-room").style.display = "inline-block"; // always-on debate — the room is always available

  if (res) { const sig = STATE.signals.find((x) => x.mint === res.mint); $("#council-token").textContent = sig ? "$" + (sig.symbol || res.mint.slice(0, 5)) : res.mint.slice(0, 6) + "…"; }
  else $("#council-token").textContent = "—";

  if (!members.length) {
    const roster = cs.roster || [];
    const active = roster.filter((m) => m.enabled && (m.provider === "anthropic" || cs.opencodeEnabled));
    $("#council-members").innerHTML = active.length
      ? `<div class="muted small">⚖ the council debates the live coins automatically — always on. Enter the room to watch. Advisory only; never overrides safety, risk, or the verdict.</div>`
      : `<div class="muted small">enable seats in CONFIG to start the always-on debate → the council never overrides safety, risk, or the verdict</div>`;
    $("#council-members").innerHTML += roster.length ? `<div class="muted small" style="margin-top:8px">seats: ${roster.map((m) => `${esc(m.label)} <span class="cm-role">${ROLE_LABEL[m.role] || m.role}</span>`).join(" · ")}<br>active now: ${active.length} ${cs.opencodeEnabled ? "" : "(opencode council off)"}</div>` : "";
    $("#council-consensus").innerHTML = "";
    return;
  }

  $("#council-members").innerHTML = members.map((m) => {
    const st = statsMap[m.id];
    const acc = st && st.resolved ? `accuracy ${Math.round(st.accuracy * 100)}% · ${st.resolved} resolved · weight ${st.weight.toFixed(2)}` : (st && st.total ? `${st.total} logged · learning` : "");
    return `<div class="cm-row">
      <div class="cm-head"><span class="cm-name">${esc(m.label)}</span><span class="cm-role">${ROLE_LABEL[m.role] || m.role}</span>${recBadge(m.recommendation)} <b>${m.score}%</b></div>
      <div class="cm-rationale">${esc((m.rationale || "").slice(0, 160))}</div>
      ${acc ? `<div class="cm-acc">${acc}</div>` : ""}
    </div>`;
  }).join("");

  if (consensus) {
    const bull = consensus.recommendation === "confirm";
    $("#council-consensus").innerHTML = `<div class="consensus-box">
      <div class="ck">CONSENSUS · ${consensus.members} SEAT${consensus.members > 1 ? "S" : ""}</div>
      <div class="consensus-score ${bull ? "green" : "gold"}">${bull ? "▲ BULLISH" : "△ CAUTION"} · ${consensus.score}%</div>
      <div class="consensus-bar"><i style="width:${consensus.score}%;background:${bull ? COL.green : COL.gold}"></i></div>
      <div class="consensus-shared">${consensus.bullModels}/${consensus.members} bullish · agreement ${consensus.agreement}%${consensus.sharedEvidence && consensus.sharedEvidence.length ? " · " + esc(consensus.sharedEvidence.join("; ")) : ""}</div>
      <div class="muted small" style="margin-top:6px">advisory only — never overrides safety, risk, or the verdict</div>
    </div>`;
  } else $("#council-consensus").innerHTML = "";
}

// ── Council Room: a live chat where the analysts debate ──
const ROLE_INITIAL = { bull_analyst: "BL", narrative_analyst: "NA", risk_analyst: "RK", contrarian: "CT", lead_reviewer: "LD" };
const roleColor = (role) => (role === "risk_analyst" || role === "contrarian" ? COL.gold : role === "lead_reviewer" ? COL.blue : COL.green);

function roomData() {
  // A live debate in progress wins; else the latest completed result's transcript.
  if (STATE.councilLive && STATE.councilLive.messages) return { ...STATE.councilLive, live: STATE.councilLive.status !== "done" };
  const res = STATE.council;
  const symOf = (mint) => { const s = STATE.signals.find((x) => x.mint === mint); return (s && s.symbol) || (mint || "").slice(0, 5); };
  if (res && res.transcript && res.transcript.length) return { symbol: symOf(res.mint), evidenceText: res.evidenceText, messages: res.transcript, consensus: res.consensus, live: false };
  if (res && (res.members || []).length) return { symbol: symOf(res.mint), evidenceText: res.evidenceText, messages: res.members.map((m) => ({ round: 1, ...m, text: m.rationale })), consensus: res.consensus, live: false };
  return null;
}

function bubble(m) {
  const bull = m.recommendation === "confirm";
  const col = roleColor(m.role);
  return `<div class="chat-msg${m.round === 2 ? " debate" : ""}">
    <div class="chat-av" style="background:${col}">${ROLE_INITIAL[m.role] || "AI"}</div>
    <div class="chat-body">
      <div class="chat-meta"><b>${esc(m.label)}</b> <span class="muted">${ROLE_LABEL[m.role] || m.role}</span>${m.model ? ` <span class="muted small">· ${esc(m.model)}</span>` : ""}${m.round === 2 ? ` <span class="chat-tag">rebuttal</span>` : ""}</div>
      <div class="chat-text">${esc(m.text || "")}</div>
      ${m.recommendation ? `<span class="chat-call ${bull ? "green" : "gold"}">${bull ? "▲ confirm" : "△ caution"}${m.score != null ? " " + m.score : ""}</span>` : ""}
    </div>
  </div>`;
}

function renderRoomChat() {
  const d = roomData();
  if (!d) { $("#room-body").innerHTML = `<div class="muted">The council is warming up — debates run automatically on the live coins and appear here within a few seconds. (If this stays empty, enable seats in CONFIG.)</div>`; return; }
  $("#room-title").textContent = (d.live ? "live debate · $" : "council debate · $") + d.symbol;
  const r1 = d.messages.filter((m) => m.round === 1);
  const r2 = d.messages.filter((m) => m.round === 2);
  let html = d.evidenceText ? `<div class="room-q"><div class="sec-label">THE QUESTION — same evidence, every analyst a different seat</div><div class="room-prompt">${esc(d.evidenceText)}</div></div>` : "";
  html += `<div class="chat-msg moderator"><div class="chat-av" style="background:var(--ink)">MOD</div><div class="chat-body"><div class="chat-meta"><b>Moderator</b></div><div class="chat-text">Analysts — opening takes on $${esc(d.symbol)}, please.</div></div></div>`;
  html += r1.map(bubble).join("");
  if (r2.length || d.live) html += `<div class="chat-divider">— DEBATE ROUND — react to the panel —</div>`;
  html += r2.map(bubble).join("");
  if (d.live) html += `<div class="chat-typing">▌ an analyst is thinking…</div>`;
  if (d.consensus) {
    const c = d.consensus, bull = c.recommendation === "confirm";
    html += `<div class="chat-msg verdict"><div class="chat-av" style="background:${bull ? COL.green : COL.gold}">∑</div><div class="chat-body"><div class="chat-meta"><b>Consensus</b></div><div class="chat-text ${bull ? "green" : "gold"}">${bull ? "▲ BULLISH" : "△ CAUTION"} ${c.score}% · ${c.bullModels}/${c.members} bullish · agreement ${c.agreement}%</div><div class="muted small">advisory only — never overrides safety, risk, or the verdict</div></div></div>`;
  }
  const body = $("#room-body"); body.innerHTML = html; body.scrollTop = body.scrollHeight;
}

function openCouncilRoom() { renderRoomChat(); $("#room").classList.add("open"); }

// ── observed-token table (State / Conviction / Evidence + clickable) ──
function stateChip(st) { return st ? `<span class="statepill st-${st}">${st.replace("_", " ")}</span>` : `<span class="muted small">—</span>`; }
function convChip(s) {
  const c = Math.round(s.conviction || 0), tier = s.convictionTier;
  const col = tier === "HIGH" ? COL.green : tier === "MEDIUM" ? COL.gold : COL.muted;
  return `<b style="color:${col}">${c}</b>${tier ? ` <span class="muted small">${tier[0]}</span>` : ""}`;
}
function evCell(s) {
  const n = s.evidenceCount, bull = s.bullCount, bear = s.bearCount;
  if (n == null && bull == null) return `<span class="muted small">—</span>`;
  return `<span class="evcount"><span class="green">▲${bull ?? "?"}</span> <span class="red">▼${bear ?? "?"}</span></span>`;
}
function feedRow(s) {
  const sel = s.mint === STATE.selectedMint ? " class=\"sel\"" : "";
  return `<tr${sel} data-mint="${esc(s.mint)}">
    <td><b>$${esc(s.symbol || s.mint.slice(0, 5))}</b></td>
    <td class="muted">${ageCell(s)}</td>
    <td>${stateChip(s.state)}</td>
    <td>${convChip(s)}</td>
    <td>${evCell(s)}</td>
    <td><span class="chip" style="background:${vcol(s.verdict)}">${s.verdict}</span></td>
  </tr>`;
}
function renderTable() {
  const rows = STATE.signals.slice(-16).reverse();
  const body = $("#feed");
  body.innerHTML = rows.length ? rows.map(feedRow).join("") : `<tr><td colspan="6" class="muted">observing — waiting for the first scored token…</td></tr>`;
  body.querySelectorAll("tr[data-mint]").forEach((tr) => (tr.onclick = () => selectToken(tr.getAttribute("data-mint"))));
}

// ── selection: fetch full graph intelligence for one token ──
async function selectToken(mint) {
  STATE.selectedMint = mint; STATE.focusEntity = null;
  renderTable();
  const intel = await api(`/token/${mint}`).catch(() => null);
  if (intel && !intel.error) { STATE.selected = intel; }
  else {
    // No full intel (evicted / not yet scored) — build a minimal view from the signal summary.
    const s = STATE.signals.find((x) => x.mint === mint);
    STATE.selected = s ? minimalIntel(s) : null;
  }
  renderSelected();
}
async function refreshSelected() {
  if (!STATE.selectedMint) return;
  const intel = await api(`/token/${STATE.selectedMint}`).catch(() => null);
  if (intel && !intel.error) { STATE.selected = intel; renderSelected(); }
}
function minimalIntel(s) {
  return {
    mint: s.mint, symbol: s.symbol, state: s.state, coverage: s.coverage, confidence: Math.round(s.conviction || 0),
    convictionTier: s.convictionTier, observationAgeMs: Date.now() - s.at, verdict: s.verdict,
    entities: [], bull: [], bear: [], bullScore: 0, bearScore: 0,
    why: (s.reasons || []).slice(0, 5), timeline: [], links: s.links, _minimal: true,
  };
}

function renderSelected() {
  const i = STATE.selected;
  const sig = STATE.selectedMint && STATE.signals.find((x) => x.mint === STATE.selectedMint);
  const verdict = (i && i.verdict) || (sig && sig.verdict) || "—";
  const tok = i ? "$" + esc(i.symbol || i.mint.slice(0, 6)) : "—";

  // observation status
  $("#obs-token").textContent = i ? tok.replace(/<[^>]+>/g, "") : "—";
  const stEl = $("#obs-state");
  stEl.textContent = i && i.state ? i.state.replace("_", " ") : "—";
  stEl.className = "obs-state " + (i && i.state ? "st-" + i.state : "");
  // i.confidence is the conviction SCORE (0-100 blend), not a probability — no "%".
  $("#obs-conf").textContent = i && i.confidence != null ? String(i.confidence) : "—";
  $("#obs-age").textContent = i ? ageMs(i.observationAgeMs || 0) : "—";
  $("#obs-tier").innerHTML = i && i.convictionTier ? `<span style="color:${i.convictionTier === "HIGH" ? COL.green : i.convictionTier === "MEDIUM" ? COL.gold : COL.muted}">${i.convictionTier}</span>` : "—";
  const cov = i && i.coverage != null ? i.coverage : 0;
  $("#obs-cover-i").style.width = cov + "%";
  $("#obs-cover-i").style.background = cov >= 60 ? COL.green : cov >= 40 ? COL.gold : COL.red;
  $("#obs-cover-t").textContent = i && i.coverage != null ? `${cov}% of the picture observed` : "how much of the picture we actually have";

  // why this token
  $("#why-token").innerHTML = i ? `Why ${tok}?` : "Why this token?";
  $("#why-verdict").innerHTML = i ? `<span style="color:${vcol(verdict)}">${verdict}</span>` : "—";
  const why = (i && i.why) || [];
  $("#why-list").innerHTML = why.length
    ? why.map((w) => `<li>${esc(w)}</li>`).join("")
    : `<li class="muted">${i && i._minimal ? "detail evicted — showing summary only" : "select a token to see the engine's reasoning"}</li>`;
  $("#why-links").innerHTML = i && i.links
    ? [["DEX", i.links.dexscreener], ["RugCheck", i.links.rugcheck], ["Solscan", i.links.solscan], ["Phantom", i.links.phantom], ["Jupiter", i.links.jupiter]]
        .filter(([, u]) => u).map(([k, u]) => `<a href="${u}" target="_blank" rel="noopener">${k} ↗</a>`).join("")
    : "";

  // evidence feed (bull / bear)
  const bull = (i && i.bull) || [], bear = (i && i.bear) || [];
  $("#ev-token").textContent = i ? tok.replace(/<[^>]+>/g, "") : "bull & bear";
  $("#ev-bull-n").textContent = bull.length; $("#ev-bear-n").textContent = bear.length;
  $("#ev-bull").innerHTML = bull.length ? bull.map((e) => `<li class="b-bull"><span>${esc(e.label)}</span><span class="w">+${e.weight}</span></li>`).join("") : `<li class="muted small">none yet</li>`;
  $("#ev-bear").innerHTML = bear.length ? bear.map((e) => `<li class="b-bear"><span>${esc(e.label)}</span><span class="w">${e.weight}</span></li>`).join("") : `<li class="muted small">none yet</li>`;

  // conflict (bull vs bear weighted)
  const bs = (i && i.bullScore) || 0, br = (i && i.bearScore) || 0, tot = bs + br;
  $("#cf-bull").style.width = (tot ? (bs / tot) * 100 : 50) + "%";
  $("#cf-bear").style.width = (tot ? (br / tot) * 100 : 50) + "%";
  $("#cf-bull-n").textContent = `▲ ${bull.length}`;
  $("#cf-bear-n").textContent = `${bear.length} ▼`;
  const net = bs - br;
  $("#cf-net").textContent = tot ? (net > 0 ? "BULL LEAN" : net < 0 ? "BEAR LEAN" : "SPLIT") : "—";
  // The lean is a raw heuristic tally, separate from the gated verdict. NEVER claim
  // "supports a position" when the engine's actual verdict isn't a BUY — the safety
  // gate / conviction caps can (and do) override a bullish lean, and showing the two
  // in contradiction would push the operator to fight the engine's own decision.
  const isBuyV = verdict === "BUY_SMALL" || verdict === "BUY_STRONG";
  const lean = net > 8
    ? (isBuyV ? "evidence supports a position" : `bullish lean — but verdict is ${verdict} (gates/caps overrode)`)
    : net < -8 ? "evidence says stay away" : "conflicted — not enough edge";
  $("#cf-verdict").innerHTML = tot
    ? `weighted <b style="color:${net >= 0 ? COL.green : COL.red}">${net >= 0 ? "+" : ""}${net}</b> — ${lean}`
    : (i && i._minimal ? "detail evicted — summary only" : "no token selected");

  // observation timeline
  const tl = (i && i.timeline) || [];
  $("#tl-list").innerHTML = tl.length
    ? tl.map((t) => `<li class="${/⚠/.test(t.label) ? "warn" : ""}"><span class="tl-t">+${ageMs(t.atMs)}</span><br>${esc(t.label)}</li>`).join("")
    : `<li class="muted small">${i ? "no timeline captured" : "select a token"}</li>`;
}

// ── PROFIT × TIME chart — the coins we bought; each line starts at 0% at buy ──
// View window over absolute time; drag to pan, zoom buttons/wheel, ⊙ snaps to now.
const CHART = { viewMs: 30 * 60_000, endAt: Date.now(), live: true, drag: false, lastX: 0 };
const imgCache = {};
function coinImg(mint) {
  if (imgCache[mint]) return imgCache[mint];
  const im = new Image(); // no crossOrigin: lets it draw even without CORS (we never read pixels)
  im.src = `https://dd.dexscreener.com/ds-data/tokens/solana/${mint}.png`;
  im.onerror = () => { im._failed = true; };
  imgCache[mint] = im;
  return im;
}
function hms(ms) { const d = new Date(ms); return d.toISOString().slice(11, 16); }

// Catmull-Rom → bezier: turn sparse PnL points into a natural smooth curve.
// Caller does beginPath()/stroke(); this only emits the path.
function smoothStroke(ctx, P) {
  if (P.length === 0) return;
  ctx.moveTo(P[0].x, P[0].y);
  if (P.length < 3) { for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].x, P[i].y); return; }
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[i + 1];
    const cp1x = p1.x + (p2.x - p0.x) / 6, cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6, cp2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

let pchartCv;
function drawProfitChart() {
  if (!pchartCv) { pchartCv = $("#pchart"); setupChartInput(pchartCv); }
  const { ctx, w, h } = fit(pchartCv, 330);
  if (CHART.live) CHART.endAt = Date.now();
  const padL = 46, padR = 12, padT = 12, padB = 22;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const midY = padT + plotH / 2;
  const viewEnd = CHART.endAt, viewStart = viewEnd - CHART.viewMs;
  const positions = (STATE.series && STATE.series.positions) || [];

  // Y scale: symmetric around 0 so the 0-line sits in the middle. Fit visible data.
  let yMax = 20;
  for (const p of positions) for (const pt of p.points) {
    if (pt.t < viewStart - CHART.viewMs || pt.t > viewEnd) continue;
    yMax = Math.max(yMax, Math.abs(pt.pnl));
  }
  yMax = Math.ceil(yMax / 10) * 10;
  const X = (t) => padL + ((t - viewStart) / CHART.viewMs) * plotW;
  const Y = (pnl) => midY - (Math.max(-yMax, Math.min(yMax, pnl)) / yMax) * (plotH / 2);

  // grid + axes
  ctx.fillStyle = "#f6f2e6"; ctx.fillRect(padL, padT, plotW, plotH);
  ctx.strokeStyle = COL.line; ctx.lineWidth = 1; ctx.font = "12px VT323"; ctx.textBaseline = "middle";
  for (const frac of [1, 0.5, 0, -0.5, -1]) {
    const yy = midY - frac * (plotH / 2); const val = Math.round(frac * yMax);
    ctx.strokeStyle = frac === 0 ? COL.ink : "rgba(180,170,140,0.5)";
    ctx.lineWidth = frac === 0 ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
    ctx.fillStyle = frac === 0 ? COL.ink : COL.muted; ctx.textAlign = "right";
    ctx.fillText((val > 0 ? "+" : "") + val + "%", padL - 5, yy);
  }
  // vertical time gridlines (5 ticks)
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let k = 0; k <= 4; k++) {
    const t = viewStart + (k / 4) * CHART.viewMs; const xx = X(t);
    ctx.strokeStyle = "rgba(180,170,140,0.3)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + plotH); ctx.stroke();
    ctx.fillStyle = COL.muted; ctx.fillText(hms(t), xx, padT + plotH + 5);
  }

  // clip to plot
  ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, plotW, plotH); ctx.clip();

  // Individual positions — faint SMOOTHED context lines (fainter as they crowd, so
  // 100+ trades never become spaghetti). The aggregate below is the hero.
  const heads = [];
  const nPos = positions.length;
  const indivA = nPos > 60 ? 0.13 : nPos > 25 ? 0.24 : 0.5;
  for (const p of positions) {
    const pts = p.points.filter((pt) => pt.t >= viewStart - CHART.viewMs && pt.t <= viewEnd + 1000);
    if (pts.length === 0) continue;
    const up = (p.curPnl ?? 0) >= 0;
    const col = up ? COL.green : COL.red;
    const P = pts.map((pt) => ({ x: X(pt.t), y: Y(pt.pnl) }));
    ctx.strokeStyle = col;
    ctx.lineWidth = p.status === "OPEN" || p.status === "PARTIAL" ? 1.6 : 1;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.globalAlpha = (p.closedAtMs ? 0.6 : 1) * indivA;
    ctx.beginPath(); smoothStroke(ctx, P); ctx.stroke();
    ctx.globalAlpha = 1;
    const last = pts[pts.length - 1];
    if (last.t >= viewStart && last.t <= viewEnd) heads.push({ p, x: X(last.t), y: Y(last.pnl), col });
  }

  // AGGREGATE hero: average PnL of positions LIVE at each sampled time — smoothed,
  // with a green-above / red-below gradient area fill to the 0 baseline. The
  // "how are my trades doing overall" line the dashboard was missing.
  const N = 64, avg = [];
  for (let k = 0; k <= N; k++) {
    const t = viewStart + (k / N) * CHART.viewMs;
    let sum = 0, cnt = 0;
    for (const p of positions) {
      const pp = p.points; if (!pp.length || pp[0].t > t) continue;
      if (p.closedAtMs && p.closedAtMs < t) continue;
      let v = null; for (let i = 0; i < pp.length; i++) { if (pp[i].t <= t) v = pp[i].pnl; else break; }
      if (v != null) { sum += v; cnt++; }
    }
    if (cnt > 0) avg.push({ x: X(t), y: Y(sum / cnt), v: sum / cnt });
  }
  if (avg.length >= 2) {
    const last = avg[avg.length - 1];
    const base = Y(0);
    const zf = Math.max(0.001, Math.min(0.999, (base - padT) / plotH));
    const g = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    g.addColorStop(0, "rgba(47,143,78,0.26)");
    g.addColorStop(zf, "rgba(47,143,78,0.03)");
    g.addColorStop(Math.min(0.999, zf + 0.001), "rgba(207,75,65,0.03)");
    g.addColorStop(1, "rgba(207,75,65,0.26)");
    ctx.beginPath(); smoothStroke(ctx, avg);
    ctx.lineTo(last.x, base); ctx.lineTo(avg[0].x, base); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); smoothStroke(ctx, avg);
    ctx.strokeStyle = COL.ink; ctx.lineWidth = 2.4; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.shadowColor = "rgba(33,36,29,0.22)"; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;
    const heroUp = last.v >= 0;
    ctx.beginPath(); ctx.arc(last.x, last.y, 4.5, 0, 7); ctx.fillStyle = heroUp ? COL.greenB : COL.red; ctx.fill();
    ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(last.x, last.y, 9, 0, 7); ctx.strokeStyle = heroUp ? COL.greenB : COL.red; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.restore();

  // heads: coin image (or fallback avatar) + symbol + live pnl, drawn over the plot
  for (const hd of heads) {
    const { p, x, y, col } = hd; const r = 11;
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.closePath();
    ctx.fillStyle = "#fff"; ctx.fill(); ctx.clip();
    const im = coinImg(p.mint);
    if (im.complete && im.naturalWidth > 0 && !im._failed) ctx.drawImage(im, x - r, y - r, r * 2, r * 2);
    else { ctx.fillStyle = col; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.fillStyle = "#fff"; ctx.font = "12px VT323"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText((p.symbol || "?")[0].toUpperCase(), x, y); }
    ctx.restore();
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = col; ctx.font = "12px VT323"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(`$${p.symbol} ${(p.curPnl >= 0 ? "+" : "") + Math.round(p.curPnl)}%`, x + r + 3, y);
  }

  if (positions.length === 0) {
    ctx.fillStyle = COL.muted; ctx.font = "15px VT323"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("no positions yet — bought coins plot here from 0% at buy time", padL + plotW / 2, midY);
  }
  requestAnimationFrame(drawProfitChart);
}
function setupChartInput(cv) {
  cv.style.cursor = "grab";
  cv.addEventListener("mousedown", (e) => { CHART.drag = true; CHART.live = false; CHART.lastX = e.clientX; cv.style.cursor = "grabbing"; setLiveBtn(); });
  window.addEventListener("mouseup", () => { CHART.drag = false; if (pchartCv) pchartCv.style.cursor = "grab"; });
  window.addEventListener("mousemove", (e) => {
    if (!CHART.drag) return;
    const plotW = (cv.clientWidth || 560) - 58;
    CHART.endAt -= ((e.clientX - CHART.lastX) / plotW) * CHART.viewMs;
    CHART.lastX = e.clientX;
    CHART.endAt = Math.min(Date.now(), CHART.endAt);
  });
  cv.addEventListener("wheel", (e) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.25 : 0.8); }, { passive: false });
}
function zoom(f) { CHART.viewMs = Math.max(2 * 60_000, Math.min(12 * 3600_000, CHART.viewMs * f)); }
function setLiveBtn() { const b = $("#ch-live"); if (b) b.classList.toggle("rz-on", CHART.live); }

// ── paper wallet (Mode 3 — simulated execution; never holds a key, never signs) ──
function paperPosRow(p) {
  const mult = p.entryPriceUsd > 0 && p.lastPriceUsd ? p.lastPriceUsd / p.entryPriceUsd : 1;
  const pnlPct = (mult - 1) * 100;
  return `<tr>
    <td><b>$${esc(p.symbol || p.mint.slice(0, 5))}</b></td>
    <td class="muted">${ageStr(p.entryAtMs)}</td>
    <td>${(p.solInvested ?? 0).toFixed(3)}</td>
    <td>${mult.toFixed(2)}x</td>
    <td><span class="${pnlPct >= 0 ? "green" : "red"}">${pctS(pnlPct)}</span></td>
    <td><span class="statepill">${esc(p.status || "OPEN")}</span></td>
  </tr>`;
}
function paperCloseRow(p) {
  const realized = p.realizedPnlUsd ?? 0, win = realized > 0;
  const peak = p.entryPriceUsd > 0 && p.peakPriceUsd ? p.peakPriceUsd / p.entryPriceUsd : 1;
  return `<tr>
    <td><b>$${esc(p.symbol || p.mint.slice(0, 5))}</b></td>
    <td><span class="${win ? "green" : "red"}">${win ? "WIN" : "LOSS"}</span></td>
    <td class="${win ? "green" : "red"}">${win ? "+" : ""}$${realized.toFixed(2)}</td>
    <td class="muted">${peak.toFixed(2)}x</td>
  </tr>`;
}
async function renderPaper() {
  const p = await api("/paper").catch(() => null);
  if (!p) return;
  const off = $("#pw-off"), body = $("#pw-body");
  if (!off || !body) return;
  if (!p.enabled) {
    $("#pw-status").innerHTML = `<span class="red">OFF</span>`;
    off.style.display = "block";
    off.innerHTML = `⚠ Paper trading is <b>OFF</b> — that's why nothing fills. Turn it on in <b>⚙ CONFIG → paper trading</b> and Save. The engine then simulates fills on BUY signals — it never holds a key or signs.`;
    body.style.display = "none";
    return;
  }
  off.style.display = "none"; body.style.display = "block";
  const st = p.stats || {}, w = p.wallet || {};
  const bal = st.balanceSol ?? w.balanceSol ?? 0;
  const openVal = st.openValueSol ?? 0;
  const equity = st.equitySol ?? (bal + openVal);
  const start = st.startingBalanceSol ?? p.startingBalanceSol ?? 0;
  $("#pw-status").innerHTML = `<span class="green">● ACTIVE</span>`;
  // Headline = EQUITY (cash + open positions) so "cash < start" reads as locked
  // capital, not a loss. Breakdown reconciles: equity = cash + open value.
  $("#pw-bal").innerHTML = `${equity.toFixed(2)} <span class="muted small">SOL equity / ${start} start</span><br><span class="muted small">${bal.toFixed(2)} cash + ${openVal.toFixed(2)} in ${st.openCount ?? 0} open</span>`;
  const pnl = st.totalPnlSol ?? 0;
  const rz = st.realizedPnlSol ?? 0, ur = st.unrealizedPnlSol ?? 0;
  $("#pw-pnl").innerHTML = `<span class="${pnl >= 0 ? "green" : "red"}">${pnl >= 0 ? "+" : ""}${pnl.toFixed(3)}</span> <span class="muted small">SOL total</span><br><span class="muted small">realized ${rz >= 0 ? "+" : ""}${rz.toFixed(2)} · unreal ${ur >= 0 ? "+" : ""}${ur.toFixed(2)}</span>`;
  $("#pw-win").textContent = `${Math.round((st.winRate ?? 0) * 100)}%`;
  $("#pw-open").textContent = st.openCount ?? (p.open || []).length;
  $("#pw-closed").textContent = st.closedCount ?? (p.closed || []).length;
  const open = (p.open || []).slice().sort((a, b) => b.entryAtMs - a.entryAtMs);
  $("#pw-positions").innerHTML = open.length
    ? open.map(paperPosRow).join("")
    : `<tr><td colspan="6" class="muted small">no open positions — fills appear here when a BUY signal clears the gate</td></tr>`;
  const closed = (p.closed || []).slice(-10).reverse();
  $("#pw-closes").innerHTML = closed.length
    ? closed.map(paperCloseRow).join("")
    : `<tr><td colspan="4" class="muted small">no closed trades yet</td></tr>`;
}

// ── reasoning feed (live "why it buys / sells / avoids") ──
const RZ = { kind: "all" };
function rzIcon(k) { return k === "council" ? "🧠" : k === "buy" ? "🟢" : k === "sell" ? "🔴" : k === "attention" ? "👁" : "⚪"; }
function rzRow(it) {
  const toneCol = it.tone === "bull" ? "green" : it.tone === "bear" ? "red" : "gold";
  const pnl = it.pnlSol != null ? ` <span class="${it.pnlSol >= 0 ? "green" : "red"}">${it.pnlSol >= 0 ? "+" : ""}${it.pnlSol.toFixed(3)} SOL</span>` : "";
  const lines = (it.lines || []).map((l) => `<div class="rz-line">${esc(l)}</div>`).join("");
  return `<div class="rz-row rz-${it.kind}">
    <div class="rz-head"><span class="rz-ic">${rzIcon(it.kind)}</span> <b>$${esc(it.symbol)}</b> <span class="rz-k ${toneCol}">${esc(it.headline)}</span>${pnl} <span class="rz-t muted">${ageStr(it.at)}</span></div>
    ${lines}
  </div>`;
}
async function renderReasoning() {
  const r = await api("/reasoning?limit=70").catch(() => null);
  const el = $("#rz-feed");
  if (!el || !r || !r.feed) return;
  const feed = RZ.kind === "all" ? r.feed : r.feed.filter((x) => x.kind === RZ.kind);
  el.innerHTML = feed.length ? feed.map(rzRow).join("") : `<div class="muted small">no ${RZ.kind === "all" ? "" : RZ.kind + " "}activity yet — the engine + council fill this as coins are scored</div>`;
}

// ── ticker ──
function renderAlerts() {
  const recent = STATE.signals.slice(-8).reverse();
  const segs = recent.map((s) => `${s.verdict === "AVOID" ? "🛑" : isBuy(s.verdict) ? "🟢" : "•"} $${s.symbol || s.mint.slice(0, 5)} ${s.verdict} ${Math.round(s.conviction)}${s.state ? " [" + s.state.replace("_", " ") + "]" : ""}`);
  const tail = `◎ MIROFISH · EVIDENCE-DRIVEN · READ-ONLY · NEVER SIGNS · OBSERVED ${commas((STATE.status && STATE.status.counts && STATE.status.counts.tokens) || 0)}`;
  $("#alerts").textContent = ((segs.join("   ·   ") || "observing…") + "      " + tail + "      ").repeat(2);
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
      STATE.signals.push(a); if (STATE.signals.length > 200) STATE.signals.shift();
      renderTable(); renderAlerts();
      if (a.mint === STATE.selectedMint) refreshSelected();
      if (isBuy(a.verdict) || a.verdict === "SELL_TRIM" || a.verdict === "SELL_EXIT_NOW") toast(a);
    } else if (m.type === "paper" && m.data && m.data.reset) {
      loadAll();
    } else if (m.type === "council") {
      const e = m.data;
      if (!STATE.councilLive || STATE.councilLive.mint !== e.mint) {
        const sig = STATE.signals.find((x) => x.mint === e.mint);
        STATE.councilLive = { mint: e.mint, symbol: e.symbol || (sig && sig.symbol) || (e.mint || "").slice(0, 5), evidenceText: "", messages: [], consensus: null, status: "running" };
      }
      if (e.kind === "question") { STATE.councilLive.evidenceText = e.evidenceText || ""; if (e.symbol) STATE.councilLive.symbol = e.symbol; }
      else if (e.kind === "message") { STATE.councilLive.messages.push(e.message); }
      else if (e.kind === "done") { STATE.councilLive.consensus = e.consensus; STATE.councilLive.status = "done"; }
      if ($("#room").classList.contains("open")) renderRoomChat();
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
  { k: "minMomentumForBuy", label: "min momentum for BUY (0=off; 85=audit edge)", t: "number" },
  { k: "riskMode", label: "risk mode", t: "select", opts: ["microfish", "fixed"] },
  { k: "heliusApiKey", label: "helius key", t: "secret" },
  { k: "anthropicApiKey", label: "anthropic key (Claude seat)", t: "secret" },
  { k: "rugcheckApiKey", label: "rugcheck key", t: "secret" },
  { k: "manusApiKey", label: "Manus API key (automated missions)", t: "secret" },
  { k: "manusAgentProfile", label: "Manus agent profile", t: "select", opts: ["manus-1.6", "manus-1.6-lite", "manus-1.6-max"] },
  { k: "manusAutoMissions", label: "auto-send Manus mission on every paper BUY (costs credits)", t: "checkbox" },
  { k: "manusMaxPerHour", label: "Manus auto-missions max/hour", t: "number" },
  { k: "councilAutoDebate", label: "always-on council debate (auto, every coin)", t: "checkbox" },
  { k: "opencodeEnabled", label: "opencode council (GPT/DeepSeek/Qwen)", t: "checkbox" },
  { k: "opencodeAutoServe", label: "auto-start opencode server", t: "checkbox" },
  { k: "opencodeModel", label: "opencode default model", t: "text" },
  { k: "opencodePort", label: "opencode port", t: "number" },
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
$("#open-room").onclick = openCouncilRoom;
$("#close-room").onclick = () => $("#room").classList.remove("open");
$("#pw-reset").onclick = async () => { if (!confirm("Reset the paper wallet to its starting balance? This clears all simulated positions.")) return; await api("/paper/reset", { method: "POST" }); renderPaper(); };
$("#rz-filters").onclick = (e) => {
  const f = e.target.closest(".rz-f"); if (!f) return;
  RZ.kind = f.getAttribute("data-k");
  document.querySelectorAll("#rz-filters .rz-f").forEach((x) => x.classList.toggle("rz-on", x === f));
  renderReasoning();
};
$("#aiform").onsubmit = async (e) => { e.preventDefault(); const mint = e.target.mint.value.trim(); $("#ai-out").textContent = "queued…"; const r = await api("/ai-computer/task", { method: "POST", body: { mint } }); $("#ai-out").textContent = r.ok ? `running ${r.taskId} — the Council Room updates shortly` : `error: ${r.error}`; };
$("#ch-out").onclick = () => zoom(1.6);
$("#ch-in").onclick = () => zoom(1 / 1.6);
$("#ch-live").onclick = () => { CHART.live = true; CHART.endAt = Date.now(); setLiveBtn(); };

// ── Project Hermes: Manus mission board + case file (operator-in-the-loop) ──
let HM_MISSION = null;
async function openHermes(prefillMint) {
  if (prefillMint) $("#hm-mint").value = prefillMint;
  $("#hermes").classList.add("open");
  renderMissions();
}
async function composeMission() {
  const mint = $("#hm-mint").value.trim();
  if (!mint) { $("#hm-out").textContent = "paste a mint first"; return; }
  $("#hm-out").textContent = "composing…";
  const r = await api("/manus/mission", { method: "POST", body: { mint } });
  if (!r.ok) { $("#hm-out").textContent = `error: ${r.error}`; $("#hm-mission").innerHTML = ""; $("#hm-result-wrap").style.display = "none"; HM_MISSION = null; return; }
  HM_MISSION = r;
  $("#hm-out").innerHTML = r.sent
    ? `<span class="green">mission #${r.id} → sent to Manus</span>${r.taskUrl ? ` · <a class="cfg gold" href="${esc(r.taskUrl)}" target="_blank" rel="noopener">🛰 watch Manus live</a>` : ""}`
    : `<span class="green">mission #${r.id} composed</span>${r.manusConfigured ? ` <span class="red">(dispatch failed: ${esc(r.sendError || "?")})</span>` : ` <span class="muted small">(no Manus key — manual board mode)</span>`}`;
  const m = r.mission;
  const card = (b) => `<div style="border:1px solid ${b.thin ? COL.red : COL.line};border-radius:4px;padding:6px 8px;min-width:150px;flex:1 1 180px">
      <div class="small" style="color:${b.thin ? COL.red : COL.green}"><b>${esc(b.key)}</b> · ${Math.round(b.coverage * 100)}%${b.thin ? " ⚠ thin" : ""}</div>
      <div class="muted small">${b.known.map(esc).join("<br>")}</div></div>`;
  $("#hm-mission").innerHTML = `
    <div style="margin-bottom:8px">${esc(m.objective)}</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${m.buckets.map(card).join("")}</div>
    <div class="muted small" style="margin-top:8px">gaps to verify: <b>${m.gaps.length ? esc(m.gaps.join(", ")) : "none"}</b></div>
    <div class="muted small" style="margin-top:4px">output contract: <code>${esc(m.outputContract)}</code></div>`;
  // Manual paste stays available as the fallback/override even when dispatched.
  $("#hm-result-wrap").style.display = "";
}
async function submitResult() {
  if (!HM_MISSION) { $("#hm-out").textContent = "compose a mission first"; return; }
  const body = { recommendation: $("#hm-rec").value, confidence: Number($("#hm-conf").value), narrative: $("#hm-narr").value.trim() || undefined };
  $("#hm-out").textContent = "submitting…";
  const r = await api(`/manus/mission/${HM_MISSION.id}/result`, { method: "POST", body });
  $("#hm-out").innerHTML = r.ok ? `<span class="green">submitted → re-scored (attention ${Math.round(r.attention)})</span>` : `<span class="red">error: ${esc(r.error)}</span>`;
  $("#hm-result-wrap").style.display = "none"; $("#hm-mission").innerHTML = ""; HM_MISSION = null;
  renderMissions(); loadAll();
}
async function renderMissions() {
  const rows = await api("/manus/missions?limit=30");
  $("#hm-list").innerHTML = Array.isArray(rows) && rows.length
    ? rows.map((m) => {
        const v = (m.mission && m.mission.verdict) || m.verdict || "?";
        const res = m.result ? ` · <b style="color:${m.result.recommendation === "confirm" ? COL.green : m.result.recommendation === "avoid" ? COL.red : COL.gold}">${esc(m.result.recommendation)}</b> (${esc(m.provider || "manus")})` : "";
        const stCol = m.status === "resolved" ? "green" : m.status === "failed" ? "red" : "gold";
        const live = m.externalUrl && (m.status === "sent" || m.status === "resolved") ? ` · <a class="cfg gold" href="${esc(m.externalUrl)}" target="_blank" rel="noopener">🛰 live</a>` : "";
        const err = m.status === "failed" && m.error ? ` · <span class="red small">${esc(m.error.slice(0, 80))}</span>` : "";
        return `<div class="rz-item" data-mint="${esc(m.mint)}" style="cursor:pointer"><b>$${esc(m.symbol || m.mint.slice(0, 6))}</b> <span class="muted">#${m.id}</span> · ${esc(v)} · <span class="${stCol}">${esc(m.status)}</span>${res}${live}${err}</div>`;
      }).join("")
    : `<div class="muted small">no missions yet — compose one above</div>`;
  $("#hm-list").querySelectorAll(".rz-item[data-mint]").forEach((el) => (el.onclick = () => { $("#hm-mint").value = el.getAttribute("data-mint"); loadCase(); }));
}
async function loadCase(mint) {
  mint = (mint || $("#hm-mint").value).trim();
  if (!mint) { $("#hm-out").textContent = "paste a mint first"; return; }
  const c = await api(`/hermes/case/${mint}`);
  if (c && c.ok === false) { $("#hm-casefile").innerHTML = `<div class="muted small">${esc(c.error)}</div>`; return; }
  const o = c.outcome || {};
  $("#hm-casefile").innerHTML = `
    <div><b>$${esc(c.symbol || mint.slice(0, 6))}</b> · current ${c.current ? `<b style="color:${vcol(c.current.verdict)}">${esc(c.current.verdict)}</b> @ ${c.current.conviction}` : "—"}</div>
    <div class="muted small">timeline: ${c.timeline && c.timeline.length ? c.timeline.map((t) => esc(t.verdict)).join(" → ") : "—"}</div>
    <div class="muted small">research: ${c.research ? `attention ${c.research.attention} · ${Math.round(c.research.confidence * 100)}% · ${esc(c.research.source)}` : "none"}</div>
    <div class="muted small">council: ${c.council.opinions} opinions · ${c.council.confirms}▲/${c.council.cautions}△ · resolved ${c.council.resolved} (${c.council.wins} win)</div>
    <div class="muted small">trades: ${c.trades.buys} buy / ${c.trades.sells} sell · realized <span class="${c.trades.realizedPnlSol >= 0 ? "green" : "red"}">${c.trades.realizedPnlSol} SOL</span></div>
    <div class="muted small">missions: ${c.missions && c.missions.length ? c.missions.map((m) => `#${m.id}:${esc(m.status)}${m.recommendation ? "/" + esc(m.recommendation) : ""}`).join(", ") : "none"}</div>
    <div class="muted small">thesis: ${c.thesis ? `entry <b style="color:${vcol(c.thesis.verdict)}">${esc(c.thesis.verdict)}</b>@${c.thesis.conviction} · attention ${c.thesis.attentionAtEntry}` : "no BUY yet"}</div>
    <div class="muted small">thesis health: ${c.thesisHealth ? `<b style="color:${c.thesisHealth.status === "broken" ? COL.red : c.thesisHealth.status === "weakening" ? COL.gold : COL.green}">${c.thesisHealth.status}</b> · entry ${c.thesisHealth.entry} → now ${c.thesisHealth.current} (Δ${c.thesisHealth.delta >= 0 ? "+" : ""}${c.thesisHealth.delta})` : "—"}</div>
    <div class="muted small">outcome: ${o.resolved ? `peak ${Math.round(o.maxGainPct)}% · worst ${Math.round(o.maxDrawdownPct || 0)}%` : "unresolved"}</div>`;
}
$("#open-hermes").onclick = () => openHermes();
$("#close-hermes").onclick = () => $("#hermes").classList.remove("open");
$("#hm-compose").onclick = composeMission;
$("#hm-submit").onclick = submitResult;
$("#hm-case").onclick = () => loadCase();
$("#send-manus").onclick = () => openHermes(STATE.selectedMint || "");

(async function boot() {
  await loadAll(); drawProfitChart(); setLiveBtn(); connectWs();
  setInterval(loadAll, 10000);
  window.addEventListener("resize", () => { renderTable(); });
})();
