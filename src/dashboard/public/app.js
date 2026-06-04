"use strict";
// Vanilla dashboard client. No build step — served as-is.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function api(path, opts) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

function fmtNum(n, d = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
}
function fmtPrice(p) {
  if (p == null) return "—";
  if (p === 0) return "0";
  if (p < 0.001) return p.toExponential(2);
  return "$" + Number(p).toPrecision(4);
}
function fmtPct(p) {
  if (p == null) return "—";
  const s = p >= 0 ? "+" : "";
  return `${s}${fmtNum(p, 1)}%`;
}
function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString();
}
function signed(n, d = 3) {
  if (n == null) return "—";
  const cls = n >= 0 ? "pos" : "neg";
  return `<span class="${cls}">${n >= 0 ? "+" : ""}${fmtNum(n, d)}</span>`;
}

const STATE = { signals: [], settings: {} };

// ── Tabs ──────────────────────────────────────────────────────────────────
const LOADERS = {};
function showTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  if (LOADERS[name]) LOADERS[name]();
}
$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (btn) showTab(btn.dataset.tab);
});

// ── Live Signals ─────────────────────────────────────────────────────────
function scoreChips(s) {
  const items = [
    ["safety", s.safety], ["organic", s.organic], ["mom", s.momentum],
    ["grad", s.graduation], ["dev", s.devReputation], ["smart", s.smartMoney],
    ["social", s.social], ["hype", s.hype], ["late", s.lateEntryRisk],
  ];
  return items.map(([k, v]) => `<span class="score">${k} <b>${Math.round(v ?? 0)}</b></span>`).join("");
}
function signalCard(a) {
  const links = a.links || {};
  return `<div class="card l-${a.kind}">
    <div class="card-top">
      <div><span class="sym">${esc(a.symbol ? "$" + a.symbol : a.name || "?")}</span>
        <div class="mint">${esc(a.mint)}</div></div>
      <span class="verdict v-${a.kind}">${a.kind} · ${Math.round(a.conviction)}</span>
    </div>
    <div class="scores">${scoreChips(a.scores || {})}</div>
    <div class="reasons">${(a.reasons || []).slice(0, 3).map(esc).join(" · ") || "—"}</div>
    ${(a.flags || []).length ? `<div class="flags">${a.flags.map((f) => `<span class="flag">${esc(f)}</span>`).join("")}</div>` : ""}
    <div class="links">
      <a href="${links.phantom}" target="_blank" rel="noopener">Phantom</a>
      <a href="${links.jupiter}" target="_blank" rel="noopener">Jupiter</a>
      <a href="${links.dexscreener}" target="_blank" rel="noopener">DexScreener</a>
      <a href="${links.rugcheck}" target="_blank" rel="noopener">RugCheck</a>
    </div>
  </div>`;
}
function renderSignals() {
  const list = $("#signals-list");
  if (!STATE.signals.length) return;
  list.innerHTML = STATE.signals.slice(0, 100).map(signalCard).join("");
  $("#signals-meta").textContent = `${STATE.signals.length} recent`;
}
LOADERS.signals = async () => {
  const rows = await api("/signals?limit=100");
  STATE.signals = rows.map((r) => ({ ...r, kind: r.verdict }));
  renderSignals();
};

// ── Positions ──────────────────────────────────────────────────────────────
function positionCard(p) {
  const last = p.lastPriceUsd ?? p.entryPriceUsd;
  const pnlPct = p.entryPriceUsd ? (last / p.entryPriceUsd - 1) * 100 : 0;
  const links = p.links || {};
  return `<div class="card l-${p.status === "CLOSED" ? "AVOID" : "WATCH_ONLY"}">
    <div class="card-top"><div><span class="sym">${esc(p.symbol ? "$" + p.symbol : p.mint.slice(0, 8))}</span>
      <div class="mint">${esc(p.mint)}</div></div><span class="verdict">${p.status}</span></div>
    <div class="scores">
      <span class="score">entry <b>${fmtPrice(p.entryPriceUsd)}</b></span>
      <span class="score">now <b>${fmtPrice(p.lastPriceUsd)}</b></span>
      <span class="score">PnL <b>${fmtPct(pnlPct)}</b></span>
      <span class="score">held <b>${fmtNum(p.tokenAmount, 0)}</b></span>
    </div>
    <div class="links"><a href="${links.jupiter}" target="_blank" rel="noopener">Sell on Jupiter</a>
      <a href="${links.dexscreener}" target="_blank" rel="noopener">Chart</a></div>
  </div>`;
}
let positionsStatus = "open";
LOADERS.positions = async () => {
  const rows = await api(`/positions?status=${positionsStatus}`);
  const list = $("#positions-list");
  list.innerHTML = rows.length ? rows.map(positionCard).join("") : `<p class="muted">No ${positionsStatus} positions.</p>`;
};
$("#positions-seg").addEventListener("click", (e) => {
  const b = e.target.closest(".seg-btn");
  if (!b) return;
  positionsStatus = b.dataset.status;
  $$("#positions-seg .seg-btn").forEach((x) => x.classList.toggle("active", x === b));
  LOADERS.positions();
});

// ── Wallet Observer ─────────────────────────────────────────────────────────
LOADERS.wallet = async () => {
  const data = await api("/wallet");
  const w = data.status || {};
  const checked = w.lastCheckedMs ? fmtTime(w.lastCheckedMs) : "—";
  $("#wallet-info").innerHTML = `
    <div class="item"><div class="k">Address</div><div class="val mono" style="font-size:12px">${esc(w.address || "not set")}</div></div>
    <div class="item"><div class="k">Observer</div><div class="val">${data.enabled ? "enabled" : "off"}</div></div>
    <div class="item"><div class="k">Connection</div><div class="val">${w.connected ? "connected" : "—"}</div></div>
    <div class="item"><div class="k">Last checked</div><div class="val" style="font-size:14px">${checked}</div></div>
    ${w.error ? `<div class="item"><div class="k">Error</div><div class="val neg" style="font-size:12px">${esc(w.error)}</div></div>` : ""}`;
  const rows = data.positions || [];
  $("#wallet-positions").innerHTML = rows.length ? rows.map(positionCard).join("") : `<p class="muted">No detected positions yet. Buy manually in Phantom and the observer will pick it up.</p>`;
};

// ── Journal ──────────────────────────────────────────────────────────────────
LOADERS.journal = async () => {
  const [rows, stats] = await Promise.all([api("/signals?limit=200"), api("/journal/stats")]);
  $("#journal-stats").textContent = `${stats.total} signals · win ${fmtNum(stats.winRate * 100, 0)}% · avg max gain ${fmtNum(stats.avgMaxGainPct, 0)}%`;
  $("#journal-table tbody").innerHTML = rows.map((s) => `<tr>
    <td>${fmtTime(s.at)}</td><td><span class="verdict v-${s.verdict}">${s.verdict}</span></td>
    <td>${esc(s.symbol ? "$" + s.symbol : s.mint.slice(0, 8))}</td>
    <td class="mono">${Math.round(s.conviction)}</td>
    <td class="mono">${Math.round(s.scores.safety)}</td><td class="mono">${Math.round(s.scores.organic)}</td>
    <td class="mono">${Math.round(s.scores.momentum)}</td><td class="mono">${Math.round(s.scores.lateEntryRisk)}</td>
    <td class="mono">${s.maxGainPct != null ? fmtPct(s.maxGainPct) : "—"}</td>
    <td>${esc((s.reasons || [])[0] || "")}</td></tr>`).join("");
};

// ── Paper Wallet ──────────────────────────────────────────────────────────
LOADERS.paper = async () => {
  const p = await api("/paper");
  const st = p.stats || {};
  const totalPnl = (st.realizedPnlSol || 0) + (st.unrealizedPnlSol || 0);
  $("#paper-stats").innerHTML = `
    <div class="item"><div class="k">Enabled</div><div class="val">${p.enabled ? "yes" : "no"}</div></div>
    <div class="item"><div class="k">Balance (SOL)</div><div class="val">${fmtNum(st.balanceSol, 3)}</div></div>
    <div class="item"><div class="k">Start (SOL)</div><div class="val">${fmtNum(st.startingBalanceSol, 2)}</div></div>
    <div class="item"><div class="k">Realized PnL</div><div class="val">${signed(st.realizedPnlSol)}</div></div>
    <div class="item"><div class="k">Unrealized</div><div class="val">${signed(st.unrealizedPnlSol)}</div></div>
    <div class="item"><div class="k">Total PnL</div><div class="val">${signed(totalPnl)}</div></div>
    <div class="item"><div class="k">Win rate</div><div class="val">${fmtNum((st.winRate || 0) * 100, 0)}%</div></div>
    <div class="item"><div class="k">Open / Closed</div><div class="val">${st.openCount || 0} / ${st.closedCount || 0}</div></div>`;
  $("#paper-open").innerHTML = (p.open || []).length ? p.open.map(positionCard).join("") : `<p class="muted">No open sim positions.</p>`;
  $("#paper-fills tbody").innerHTML = (p.fills || []).map((f) => `<tr>
    <td>${fmtTime(f.at)}</td><td>${f.side}</td><td>${esc(f.mint.slice(0, 8))}</td>
    <td class="mono">${fmtPrice(f.priceUsd)}</td><td class="mono">${fmtNum(f.solAmount, 3)}</td>
    <td class="mono">${signed(f.realizedPnlSol)}</td><td>${esc(f.reason || "")}</td></tr>`).join("");
};
$("#paper-reset").addEventListener("click", async () => {
  if (!confirm("Reset the paper wallet to its starting balance? This clears sim positions + fills.")) return;
  await api("/paper/reset", { method: "POST" });
  toast({ kind: "SELL_TRIM", symbol: "PAPER", reasons: ["wallet reset"], conviction: 0 }, "Paper wallet reset");
  LOADERS.paper();
});

// ── Backtest ─────────────────────────────────────────────────────────────────
LOADERS.backtest = async () => {
  const data = await api("/learning");
  $("#backtest-table tbody").innerHTML = (data.backtests || []).map((b) => `<tr>
    <td>${fmtTime(b.at)}</td><td class="mono">${esc(JSON.stringify(b.settings))}</td>
    <td>${b.trades}</td><td>${fmtNum(b.winRate * 100, 0)}%</td><td class="mono">${signed(b.totalPnlSol)}</td>
    <td class="mono">${fmtNum(b.maxDrawdownPct, 0)}%</td><td class="mono">${fmtPct(b.bestTradePct)}</td>
    <td class="mono">${fmtPct(b.worstTradePct)}</td></tr>`).join("");
};
$("#backtest-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const overrides = {};
  for (const [k, v] of fd.entries()) if (v !== "") overrides[k] = Number(v);
  const r = await api("/backtest", { method: "POST", body: { overrides } });
  if (r && r.ok === false) alert(r.error || "Backtest not available yet.");
  LOADERS.backtest();
});

// ── Learning ─────────────────────────────────────────────────────────────────
LOADERS.learning = async () => {
  const data = await api("/learning");
  $$("#learning-mode .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === data.mode));
  const sug = $("#learning-suggestions");
  sug.innerHTML = (data.pending || []).length
    ? data.pending.map((s) => `<div class="card">
        <div class="reasons">${esc(s.rationale)}</div>
        <div class="scores"><span class="score">${esc(s.setting)} <b>${s.from} → ${s.to}</b></span></div>
        <div class="links">
          <button class="btn sm" data-apply="${s.id}">Apply</button>
          <button class="btn sm ghost" data-ignore="${s.id}">Ignore</button></div>
      </div>`).join("")
    : `<p class="muted">No suggestions yet — they appear after a soak.</p>`;
  $("#learning-history tbody").innerHTML = (data.history || []).map((h) => `<tr>
    <td>${fmtTime(h.at)}</td><td>${esc(h.setting)}</td><td class="mono">${esc(h.from)}</td>
    <td class="mono">${esc(h.to)}</td><td>${h.by}</td><td>${esc(h.note || "")}</td></tr>`).join("");
};
$("#learning-suggestions").addEventListener("click", async (e) => {
  const apply = e.target.closest("[data-apply]");
  const ignore = e.target.closest("[data-ignore]");
  if (apply) { await api(`/learning/suggestions/${apply.dataset.apply}/apply`, { method: "POST" }); LOADERS.learning(); }
  if (ignore) { await api(`/learning/suggestions/${ignore.dataset.ignore}/ignore`, { method: "POST" }); LOADERS.learning(); }
});
$("#learning-mode").addEventListener("click", async (e) => {
  const b = e.target.closest(".seg-btn");
  if (!b) return;
  await api("/learning/mode", { method: "POST", body: { mode: b.dataset.mode } });
  LOADERS.learning();
});

// ── Settings ─────────────────────────────────────────────────────────────────
const SETTINGS_FORM = [
  { legend: "Wallet (read-only — public address only, never a seed phrase)", fields: [
    { k: "walletAddress", label: "Public wallet address", type: "text", full: true },
    { k: "walletObserverEnabled", label: "Enable observer", type: "checkbox" },
  ]},
  { legend: "Alerts", fields: [
    { k: "desktopNotifications", label: "Desktop notifications", type: "checkbox" },
    { k: "sound", label: "Sound", type: "checkbox" },
    { k: "minConviction", label: "Min conviction to notify", type: "number" },
  ]},
  { legend: "Risk", fields: [
    { k: "maxTopHolderPct", label: "Max top-holder %", type: "number" },
    { k: "minOrganicScore", label: "Min organic score", type: "number" },
    { k: "maxLateEntryRisk", label: "Max late-entry risk", type: "number" },
    { k: "maxHoldMinutes", label: "Max hold (minutes)", type: "number" },
    { k: "minLiquidityUsd", label: "Min liquidity (USD)", type: "number" },
  ]},
  { legend: "Paper Trading (simulation only)", fields: [
    { k: "paperEnabled", label: "Enable paper trading", type: "checkbox" },
    { k: "paperStartingBalanceSol", label: "Starting balance (SOL)", type: "number" },
    { k: "paperMaxPositionSol", label: "Max position size (SOL)", type: "number" },
    { k: "paperRiskPerTradePct", label: "Risk per trade %", type: "number" },
  ]},
  { legend: "Learning", fields: [
    { k: "learningMode", label: "Mode", type: "select", options: ["manual", "auto"] },
  ]},
  { legend: "API keys (all optional — stored locally, never committed)", fields: [
    { k: "heliusApiKey", label: "Helius", type: "secret" },
    { k: "birdeyeApiKey", label: "Birdeye", type: "secret" },
    { k: "anthropicApiKey", label: "Anthropic (AI hype)", type: "secret" },
    { k: "rugcheckApiKey", label: "RugCheck", type: "secret" },
    { k: "lunarcrushApiKey", label: "LunarCrush (social)", type: "secret" },
  ]},
];
function settingField(f, s) {
  const v = s[f.k];
  if (f.type === "checkbox")
    return `<label class="row"><input type="checkbox" name="${f.k}" ${v ? "checked" : ""}/> ${esc(f.label)}</label>`;
  if (f.type === "select")
    return `<label>${esc(f.label)}<select name="${f.k}">${f.options.map((o) => `<option ${o === v ? "selected" : ""}>${o}</option>`).join("")}</select></label>`;
  if (f.type === "secret")
    return `<label>${esc(f.label)} ${v ? "<span class='pill on'>set</span>" : ""}<input type="password" name="${f.k}" placeholder="${v ? "•••••• (leave blank to keep)" : "not set"}"/></label>`;
  const cls = f.full ? "full" : "";
  return `<label class="${cls}">${esc(f.label)}<input type="${f.type}" name="${f.k}" value="${esc(v ?? "")}"/></label>`;
}
LOADERS.settings = async () => {
  const s = await api("/settings");
  STATE.settings = s;
  applyStatusPills(s);
  const form = $("#settings-form");
  form.innerHTML = SETTINGS_FORM.map((group) =>
    `<fieldset><legend>${esc(group.legend)}</legend><div class="form grid">${group.fields.map((f) => settingField(f, s)).join("")}</div></fieldset>`
  ).join("") +
  `<div class="full row"><button class="btn" id="settings-save" type="button">Save settings</button>
     <button class="btn ghost" id="settings-test" type="button">Test wallet connection</button>
     <button class="btn danger" id="settings-reset" type="button">Reset to defaults</button>
     <span class="muted" id="settings-result"></span></div>`;

  $("#settings-save").addEventListener("click", saveSettings);
  $("#settings-test").addEventListener("click", testConnection);
  $("#settings-reset").addEventListener("click", async () => {
    if (!confirm("Reset all settings to defaults?")) return;
    await api("/settings/reset", { method: "POST" });
    LOADERS.settings();
  });
};
function collectSettings() {
  const form = $("#settings-form");
  const out = {};
  for (const group of SETTINGS_FORM) for (const f of group.fields) {
    const el = form.querySelector(`[name="${f.k}"]`);
    if (!el) continue;
    if (f.type === "checkbox") out[f.k] = el.checked;
    else if (f.type === "number") { if (el.value !== "") out[f.k] = Number(el.value); }
    else if (f.type === "secret") { if (el.value !== "") out[f.k] = el.value; }
    else out[f.k] = el.value;
  }
  return out;
}
async function saveSettings() {
  const r = await api("/settings", { method: "PUT", body: collectSettings() });
  $("#settings-result").textContent = r.ok ? `saved (${(r.changed || []).length} changed)` : `error: ${r.error}`;
  if (r.ok) { STATE.settings = r.settings; applyStatusPills(r.settings); }
}
async function testConnection() {
  const addr = $("#settings-form [name='walletAddress']").value;
  $("#settings-result").textContent = "testing…";
  const r = await api("/settings/test-connection", { method: "POST", body: { address: addr } });
  $("#settings-result").textContent = r.ok ? `OK — balance ${fmtNum(r.balanceSol, 3)} SOL` : `failed: ${r.error}`;
}

// ── Status pills + toasts + websocket ────────────────────────────────────────
function applyStatusPills(s) {
  const wp = $("#pill-wallet"); wp.textContent = `Wallet: ${s.walletObserverEnabled ? "on" : "off"}`; wp.className = `pill ${s.walletObserverEnabled ? "on" : "off"}`;
  const pp = $("#pill-paper"); pp.textContent = `Paper: ${s.paperEnabled ? "on" : "off"}`; pp.className = `pill ${s.paperEnabled ? "on" : "off"}`;
}
const LOUD = new Set(["BUY_STRONG", "BUY_SMALL", "SELL_TRIM", "SELL_EXIT_NOW"]);
function toast(a, msgOverride) {
  const el = document.createElement("div");
  el.className = `toast ${a.kind}`;
  el.innerHTML = `<div class="t-title">${a.kind} ${esc(a.symbol ? "$" + a.symbol : "")} ${a.conviction ? "· " + Math.round(a.conviction) : ""}</div>
    <div class="t-msg">${esc(msgOverride || (a.reasons || [])[0] || a.mint || "")}</div>`;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 6000);
}
function onAlert(a) {
  STATE.signals.unshift({ ...a, kind: a.kind });
  STATE.signals = STATE.signals.slice(0, 120);
  if ($("#tab-signals").classList.contains("active")) renderSignals();
  if (LOUD.has(a.kind)) toast(a);
}
function connectWs() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  const pill = $("#pill-ws");
  ws.onopen = () => { pill.textContent = "ws: live"; pill.className = "pill on"; };
  ws.onclose = () => { pill.textContent = "ws: down"; pill.className = "pill bad"; setTimeout(connectWs, 2000); };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "alert") onAlert(m.data);
    else if (m.type === "settings") applyStatusPills(m.data);
    else if (m.type === "paper" && $("#tab-paper").classList.contains("active")) LOADERS.paper();
    else if (m.type === "wallet" && $("#tab-wallet").classList.contains("active")) LOADERS.wallet();
    else if (m.type === "position") {
      if ($("#tab-wallet").classList.contains("active")) LOADERS.wallet();
      if ($("#tab-positions").classList.contains("active")) LOADERS.positions();
    }
  };
}

// ── Boot ──────────────────────────────────────────────────────────────────
(async function boot() {
  connectWs();
  const s = await api("/settings"); STATE.settings = s; applyStatusPills(s);
  showTab("signals");
})();
