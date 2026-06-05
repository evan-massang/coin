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
const ET = { TOKEN: COL.ink, DEV: COL.blue, BUYERS: COL.green, CLUSTER: COL.gold, SMART_MONEY: COL.blue, NARRATIVE: COL.gold, KNOWN_RUG: COL.red, UNVERIFIED: COL.muted };
const ENT_DESC = {
  TOKEN: "the token itself — the thing under investigation",
  DEV: "deployer wallet — did the creator dump on holders?",
  BUYERS: "organic buyers — real demand vs wash trading",
  CLUSTER: "buyer cluster — checked for coordinated / bundled entry",
  SMART_MONEY: "tracked smart-money wallets entered this token",
  NARRATIVE: "narrative / social trend strength",
  KNOWN_RUG: "matches a known rug fingerprint or bundle pattern",
  UNVERIFIED: "data the engine could not verify (unknowns)",
};
const vcol = (v) => VC[v] || COL.muted;
const isBuy = (v) => v === "BUY_SMALL" || v === "BUY_STRONG";

const STATE = {
  signals: [], status: null, market: null, engine: null, council: null, councilStats: null,
  councilLive: null, selectedMint: null, selected: null, focusEntity: null, bootAt: Date.now(),
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
    <td class="muted">${ageStr(s.at)}</td>
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
  $("#obs-conf").textContent = i && i.confidence != null ? i.confidence + "%" : "—";
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
  $("#cf-verdict").innerHTML = tot
    ? `weighted <b style="color:${net >= 0 ? COL.green : COL.red}">${net >= 0 ? "+" : ""}${net}</b> — ${net > 8 ? "evidence supports a position" : net < -8 ? "evidence says stay away" : "conflicted — not enough edge"}`
    : (i && i._minimal ? "detail evicted — summary only" : "no token selected");

  // observation timeline
  const tl = (i && i.timeline) || [];
  $("#tl-list").innerHTML = tl.length
    ? tl.map((t) => `<li class="${/⚠/.test(t.label) ? "warn" : ""}"><span class="tl-t">+${ageMs(t.atMs)}</span><br>${esc(t.label)}</li>`).join("")
    : `<li class="muted small">${i ? "no timeline captured" : "select a token"}</li>`;

  // graph label
  $("#graph-token").textContent = i ? tok.replace(/<[^>]+>/g, "") : "select a token";
}

// ── investigation graph (selected token's entities; clickable nodes) ──
let graphCv; const graphNodes = []; let wob = 0;
function drawGraph() {
  if (!graphCv) { graphCv = $("#graph"); graphCv.onclick = onGraphClick; }
  const { ctx, w, h } = fit(graphCv, 320);
  const i = STATE.selected;
  const ents = (i && i.entities) || [];
  const cx = w / 2, cy = h / 2; wob += 0.01;
  graphNodes.length = 0;

  $("#graph-stats").textContent = i ? `nodes ${ents.length} · ${esc(i.symbol || "?")}` : "nodes 0";
  $("#legend").innerHTML = [["TOKEN", ET.TOKEN], ["DEV", ET.DEV], ["BUYERS", ET.BUYERS], ["CLUSTER", ET.CLUSTER], ["SMART MONEY", ET.SMART_MONEY], ["NARRATIVE", ET.NARRATIVE], ["RUG / SNIPER", ET.KNOWN_RUG]]
    .map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join("");

  // non-center entities arranged around the token
  const around = ents.filter((e) => e.type !== "TOKEN");
  around.forEach((e, idx) => {
    const ang = (idx / Math.max(around.length, 1)) * Math.PI * 2 + wob;
    const R = 108 + Math.sin(wob * 2 + idx) * 5;
    const x = cx + Math.cos(ang) * R, y = cy + Math.sin(ang) * (R * 0.6);
    const col = ET[e.type] || COL.muted;
    ctx.strokeStyle = STATE.focusEntity === e.id ? col : "rgba(120,120,90,0.3)";
    ctx.lineWidth = STATE.focusEntity === e.id ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
    graphNodes.push({ id: e.id, x, y, r: 9, ent: e });
  });
  graphNodes.forEach(({ x, y, ent }) => {
    const col = ET[ent.type] || COL.muted;
    ctx.beginPath(); ctx.arc(x, y, STATE.focusEntity === ent.id ? 9 : 7, 0, 7); ctx.fillStyle = col; ctx.fill();
    if (STATE.focusEntity === ent.id) { ctx.strokeStyle = COL.ink; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.fillStyle = COL.ink; ctx.font = "13px VT323"; ctx.textAlign = "center";
    ctx.fillText(ent.label, x, y - 12); ctx.fillStyle = COL.muted; ctx.fillText(ent.sub || "", x, y + 21);
  });
  // center token
  const tEnt = ents.find((e) => e.type === "TOKEN");
  ctx.beginPath(); ctx.arc(cx, cy, i ? 14 : 8, 0, 7); ctx.fillStyle = i ? vcol((i && i.verdict) || "WATCH_ONLY") : COL.muted; ctx.fill();
  ctx.strokeStyle = COL.ink; ctx.lineWidth = 2; ctx.stroke();
  graphNodes.push({ id: "__token__", x: cx, y: cy, r: 16, ent: tEnt || { type: "TOKEN", label: i ? "$" + (i.symbol || "") : "", sub: (i && i.verdict) || "" } });
  if (i) { ctx.fillStyle = COL.ink; ctx.font = "15px VT323"; ctx.textAlign = "center"; ctx.fillText("$" + (i.symbol || i.mint.slice(0, 5)), cx, cy + 34); }
  requestAnimationFrame(drawGraph);
}
function onGraphClick(ev) {
  const rect = graphCv.getBoundingClientRect();
  const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
  let hit = null, best = 18;
  for (const n of graphNodes) { const d = Math.hypot(mx - n.x, my - n.y); if (d < best) { best = d; hit = n; } }
  if (!hit) return;
  if (hit.id === "__token__") { STATE.focusEntity = null; $("#graph-focus").textContent = "the token under investigation — see Why & Evidence panels"; return; }
  STATE.focusEntity = hit.id;
  const e = hit.ent;
  $("#graph-focus").innerHTML = `<b style="color:${ET[e.type] || COL.muted}">${esc(e.label)}</b> · ${esc(e.sub || "")} — ${esc(ENT_DESC[e.type] || "")}`;
}

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
  $("#pw-status").innerHTML = `<span class="green">● ACTIVE</span>`;
  $("#pw-bal").innerHTML = `${bal.toFixed(3)} <span class="muted small">/ ${p.startingBalanceSol || 0}</span>`;
  const pnl = st.totalPnlSol ?? 0;
  $("#pw-pnl").innerHTML = `<span class="${pnl >= 0 ? "green" : "red"}">${pnl >= 0 ? "+" : ""}${pnl.toFixed(3)}</span> <span class="muted small">SOL</span>`;
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
function rzIcon(k) { return k === "council" ? "🧠" : k === "buy" ? "🟢" : k === "sell" ? "🔴" : "⚪"; }
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
  { k: "riskMode", label: "risk mode", t: "select", opts: ["microfish", "fixed"] },
  { k: "heliusApiKey", label: "helius key", t: "secret" },
  { k: "anthropicApiKey", label: "anthropic key (Claude seat)", t: "secret" },
  { k: "rugcheckApiKey", label: "rugcheck key", t: "secret" },
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

(async function boot() {
  await loadAll(); drawGraph(); connectWs();
  setInterval(loadAll, 10000);
  window.addEventListener("resize", () => { renderTable(); });
})();
