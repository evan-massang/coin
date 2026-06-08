# MIROFISH INTELLIGENCE — QA Audit Report

**Method:** Black-box. Application launched locally and driven through the browser with Playwright (Chromium). Findings derive **only from observed UI behavior** — no source code was trusted or used to reach conclusions. Root causes are inferences from behavior, explicitly labeled as such.

**Target:** `http://127.0.0.1:3000/` (local dev server, `npm run dev`)
**Posture:** Every feature assumed broken until demonstrated. Language per project Rule 1: **Verified Working** / **Not Verified**.
**Date of run:** 2026-06-07 (UTC timestamps visible in screenshots)

---

## Summary

| # | Area | Claim vs Actual | Severity | Status |
|---|------|-----------------|----------|--------|
| 1 | Paper wallet | `BALANCE` drop (−3.66 SOL) ≠ `TOTAL PNL` (−1.49 SOL) | **HIGH** | Not Verified (contradictory) |
| 2 | Token STATE | Tokens 1–49s old shown `ARCHIVED` / `MATURE` | **HIGH** | Not Verified (contradictory) |
| 3 | Conviction/Decision | `DECISION READY` + `BUY_SMALL` on a 1-second-old token | **HIGH** | Not Verified (contradictory) |
| 4 | KPI funnel | `DECISION READY` (20) > `OBSERVING` (12) | **MEDIUM** | Not Verified (impossible) |
| 5 | "OBSERVING" timer | Reads ~00:00:21 while engine has hours of history | **MEDIUM** | Not Verified (misleading) |
| 6 | Council models | Config advertises GPT/DeepSeek; only ollama seats ran | **MEDIUM** | Not Verified (mismatch) |
| 7 | Council roles | "Bull Analyst" argues the bear case | **LOW–MED** | Not Verified (mismatch) |
| 8 | Token logos | 20+ image requests fail (`ERR_BLOCKED_BY_ORB`) | **LOW** | Not Verified (broken resource) |
| 9 | WHY panel text | Duplicate label "narrative: narrative: finance" | **LOW** | Not Verified (intermittent) |
| 10 | WHY evidence | "insufficient trade data" beside precise metrics | **LOW** | Not Verified (contradictory) |

### Verified Working (demonstrated, for fairness)
- **App launches / dashboard loads** — HTTP 200, full render. *(Evidence: `_dashboard.png`)*
- **Paper trading is live and updating** — balance, open positions, total PnL, win rate, and Recent Closes all render and change over a 5-minute observation; closed-count climbed 40→44. *(Evidence: `_paper_panel.png`, `_paper_timeline.json`)*
- **Token row → coin selection** — clicking a table row updates the Status + WHY panels to that coin (clicked `$Sbtc` → panel switched to `$Sbtc`). *(Evidence: `_qa_after_rowclick.png`)*
- **Council Room** — opens a live multi-seat debate with a Moderator, analyst seats, caution scores, and a consensus line (`CONSENSUS · 5 SEATS · CAUTION 42%`). *(Evidence: `_qa_room.png`, `_qa_room2.png`)*
- **External links** — DEX / RugCheck / Solscan / Phantom / Jupiter resolve to correct, coin-specific URLs for the selected mint. *(Evidence: `_qa_observations.json` → `links`)*
- **No client-side errors** — zero JS console errors, zero uncaught page errors, zero 4xx/5xx app responses during the session. *(Evidence: `_qa_observations.json`)*

---

## Findings

### 1. [HIGH] Paper wallet `BALANCE` and `TOTAL PNL` do not reconcile
- **Claim:** Panel headline reads `BALANCE (SOL) 34.343 / 38` and `TOTAL PNL −1.492 SOL`.
- **Actual:** Balance is down **3.657 SOL** from the 38 start, yet Total PnL claims only **−1.492 SOL**. A **~2.17 SOL** difference is unexplained anywhere in the UI. There is no "equity," "deployed capital," or "cash vs. position value" line.
- **Reproduction:** Open dashboard → scroll to `💵 PAPER WALLET` → compare `BALANCE` to `TOTAL PNL`. Observed across multiple samples (gap 2.0–2.17 SOL).
- **Evidence:** `_paper_panel.png`, `_qa_final.json` (`paper.balanceDrop=3.657`, `paper.totalPnl=-1.492`, `paper.gap=2.165`)
- **Root cause (inferred from behavior):** `BALANCE` appears to be **free cash only**, while `TOTAL PNL` includes the unrealized value of the ~36–43 still-open positions. The capital locked in open positions is never surfaced, so the two headline numbers read as a direct contradiction to a user.
- **Fix recommendation:** Add an explicit **Equity** (cash + open-position value) and **Deployed** line; relabel `BALANCE` as **Cash**. Guarantee the identity `Cash + Σ(open value) − Start = Total PnL` and display it so the headline figures reconcile.

### 2. [HIGH] Token `STATE` contradicts `AGE` (ARCHIVED / MATURE on seconds-old tokens)
- **Claim:** The Observed Tokens table presents a lifecycle `STATE` column alongside `AGE`.
- **Actual:** Brand-new tokens carry terminal/aged states:
  - `$DALI` — **13s** — `ARCHIVED`
  - `$LEAVE` — **17s** — `ARCHIVED`
  - `$killer` — **25s** — `ARCHIVED`
  - `$100mil` — **25s** — `MATURE`
  A token cannot be "ARCHIVED" or "MATURE" at 13–25 seconds of age.
- **Reproduction:** Open dashboard → Observed Tokens table → read `AGE` against `STATE`. Reproduced every sample.
- **Evidence:** `_qa_table.png`, `_qa_final.json` (`archivedYoung`)
- **Root cause (inferred):** The `STATE` transition logic is decoupled from the `AGE` clock — either states are assigned without an age/observation-duration input, or `AGE` displays the token's mint age while `STATE` is driven by a different (or uninitialized) timer.
- **Fix recommendation:** Tie `STATE` transitions to observed age/coverage; forbid `MATURE`/`ARCHIVED` below a minimum age. Add an invariant test: `STATE=ARCHIVED ⇒ AGE ≥ archive_threshold`.

### 3. [HIGH] Full-confidence decisions on tokens with seconds of history
- **Claim:** KPI card asserts `DECISION READY — enough evidence to call`. Conviction is shown 0–100.
- **Actual:**
  - `$DALLY` — **1s** — `DECISION READY`, conviction `59`, verdict **`BUY_SMALL`**
  - `$Slop` — **17s** — `DECISION READY`, conviction `72 H`, verdict **`BUY_STRONG`**
  - `$MAYHEM` — **4s** — conviction **`100`**, verdict **`SELL_EXIT_NOW`**
  A 1-second-old coin being "decision ready" with a BUY call, and max conviction (100) at 4 seconds, contradict the premise that evidence accrues over time (and the system's own "insufficient trade data" messaging — see Finding 10).
- **Reproduction:** Open dashboard → Observed Tokens table → inspect newest rows (`AGE` ≤ 5s) for `DECISION READY` / conviction 100.
- **Evidence:** `_qa_table.png`
- **Root cause (inferred):** Conviction / decision-readiness is not gated on a minimum observation window or data-sufficiency threshold; scoring emits high-confidence calls immediately on first data point.
- **Fix recommendation:** Gate `DECISION READY` and BUY/SELL verdicts behind minimum age + data-coverage thresholds; clamp conviction until sufficiency is met.

### 4. [MEDIUM] KPI funnel is internally impossible: `DECISION READY` > `OBSERVING`
- **Claim:** Header cards read top-of-funnel `OBSERVING — tokens under watch` → `DECISION READY — enough evidence to call`.
- **Actual:** Captured `OBSERVING 12` while `DECISION READY 20`. Also observed `OBSERVING 18 / DECISION READY 21`. `DECISION READY` stayed pinned ~20–22 while `OBSERVING` swung 12 → 18 → 23 → 26. A downstream funnel count cannot exceed its upstream.
- **Reproduction:** Open dashboard → read the four header cards; refresh/observe over ~1 min. The downstream value repeatedly exceeds upstream.
- **Evidence:** `_qa_kpi.png` (shows `OBSERVING 12`, `DECISION READY 20`), `_qa_room.json` (18 / 21)
- **Root cause (inferred):** The two counters are computed over **different populations or time windows** (e.g., `OBSERVING` = currently-live set; `DECISION READY` = cumulative/all-time), yet are presented as one funnel.
- **Fix recommendation:** Compute both metrics over the same population/window and enforce `DECISION_READY ≤ OBSERVING`; otherwise relabel so the cards are not read as a funnel.

### 5. [MEDIUM] "OBSERVING HH:MM:SS" uptime resets on page load
- **Claim:** Header shows `OBSERVING 00:00:21`, implying total system observation time.
- **Actual:** Loads at `00:00:05` and increments per page session (verified incrementing 00:00:05 → 00:00:09 → 00:00:21). Meanwhile the engine clearly has **hours** of history — open positions aged 1500–1602 minutes (~25–27h) and 40+ closed paper trades.
- **Reproduction:** Load dashboard, note timer near 00:00:0x; reload → it restarts. Compare to position ages in the paper wallet.
- **Evidence:** `_qa_observations.json` (`t1=00:00:05`, `t2=00:00:09`, `timerIncremented=true`), `_paper_panel.png` (positions aged >1500m)
- **Root cause (inferred):** Timer is driven by the **browser/page session start**, not the engine's start time.
- **Fix recommendation:** Source the timer from a server-reported engine start timestamp so it reflects real observation uptime across reloads.

### 6. [MEDIUM] Council advertises GPT/DeepSeek seats; only local ollama seats observed
- **Claim:** CONFIG shows `OPENCODE COUNCIL (GPT/DEEPSEEK/QWEN)` enabled and `OPENCODE DEFAULT MODEL openai/gpt-4o`.
- **Actual:** The live debate seats were `Qwen 3B · ollama/qwen2.5:3b`, `Llama 3.2 · ollama/llama3.2:3b`, `Qwen 1.5B Lead Reviewer`. No GPT-4o or DeepSeek seat was observed participating.
- **Reproduction:** CONFIG → read OpenCode settings; close → `▸ ENTER THE ROOM` → read seat model labels.
- **Evidence:** `_qa_room2.png` (ollama model tags), CONFIG capture (`opencodeModel=openai/gpt-4o`, `anthropicApiKey=not set`)
- **Root cause (inferred):** The advertised cloud/OpenCode seats are not actually running (no provider seat appeared); the council falls back to local ollama models while the UI continues to advertise GPT/DeepSeek.
- **Fix recommendation:** Render the **actually active** seats/models, or show a clear "OpenCode seats inactive — using local models" status when cloud seats are unavailable.

### 7. [LOW–MEDIUM] Seat role contradicts its output ("Bull Analyst" argues bearish)
- **Claim:** Seat labeled **`Qwen 3B — Bull Analyst`**.
- **Actual:** Its message: *"Lack of clear bullish indicators outweighs minimal bearish points but overall evidence is thin"* → tagged **`caution 25`**. The bull seat argues caution/bear.
- **Reproduction:** `ENTER THE ROOM` → read the Bull Analyst seat's stance.
- **Evidence:** `_qa_room2.png`
- **Root cause (inferred):** The role label is decorative — not enforced in the model prompt — so seats don't reliably argue their assigned side.
- **Fix recommendation:** Enforce the assigned stance in each seat's prompt, or drop role labels that aren't honored.

### 8. [LOW] Token logo images fail to load
- **Claim:** Rows are designed to show token icons (image requests are issued per token).
- **Actual:** 20+ requests to `cdn.dexscreener.com/tokens/solana/<mint>.png` fail with `net::ERR_BLOCKED_BY_ORB`. Icons do not render.
- **Reproduction:** Open dashboard with devtools/network capture → observe blocked image requests.
- **Evidence:** `_qa_observations.json` → `failedReqs` (20 entries)
- **Root cause (inferred):** Cross-origin image hotlinking is blocked by the browser's Opaque Response Blocking / CDN protection.
- **Fix recommendation:** Proxy token images through the local server (same-origin), or render a fallback glyph and handle the broken-image state gracefully.

### 9. [LOW] WHY panel duplicate label: "narrative: narrative: finance"
- **Claim:** WHY panel lists evidence bullets, e.g. a narrative tag.
- **Actual:** Observed `narrative: narrative: finance` — the label prefix is duplicated. **Intermittent** — seen in an earlier capture for `$Taylor`, not reproduced in this session's coin set.
- **Reproduction:** Select various coins and read the WHY bullets; appears on coins whose narrative value already contains the prefix.
- **Evidence:** `_dash_top.png` (prior capture, `$Taylor` WHY panel)
- **Root cause (inferred):** A template concatenates a `narrative:` prefix onto a value that already includes `narrative:`.
- **Fix recommendation:** De-duplicate the prefix when composing the bullet.

### 10. [LOW] WHY evidence contradicts itself: "insufficient trade data" beside precise metrics
- **Claim/Actual:** For `$Taylor`, the WHY panel simultaneously stated `BUY_STRONG`, `dex: 38 txns/5m, buy-pressure organic 75`, `buy pressure 100%`, **and** `insufficient trade data`. Reporting precise 5-minute transaction counts and 100% buy pressure while also declaring trade data insufficient is contradictory.
- **Reproduction:** Select a coin whose WHY shows both a buy-pressure metric and the "insufficient trade data" bullet.
- **Evidence:** `_dash_top.png` (prior capture, `$Taylor` WHY panel)
- **Root cause (inferred):** Evidence bullets are assembled from independent checks that aren't reconciled — a "data sufficiency" flag fires independently of the metrics that are nonetheless displayed.
- **Fix recommendation:** Suppress or reconcile mutually exclusive evidence bullets; if data is insufficient, don't also present derived precise metrics (or mark them low-confidence).

---

## Notes & limitations
- The "READ-ONLY · never holds a key, never signs, never auto-trades" claim **could not be contradicted** from the UI (no signing flow, paper execution only) but also **cannot be fully verified** black-box. Status: **Not Verified** (no contradicting evidence observed).
- CONFIG actions `SAVE`, `TEST WALLET`, `RESET PAPER`, `RUN RESEARCH`, and `⤓ DOWNLOAD REPORT` were **not exercised** in this pass (to avoid mutating paper state / triggering external research). Status: **Not Verified**.
- Counts and table contents are live and change every few seconds; findings 2–4 were reproduced across multiple independent samples and captured in screenshots.

## Evidence index (files in repo root)
- `_dashboard.png`, `_dash_top.png` — full dashboard + header (incl. WHY contradiction)
- `_paper_panel.png`, `_paper_timeline.json` — paper wallet + 5-min observation
- `_qa_kpi.png` — KPI funnel contradiction (`OBSERVING 12 / DECISION READY 20`)
- `_qa_table.png`, `_qa_final.json` — STATE-vs-AGE and instant-decision contradictions
- `_qa_room.png`, `_qa_room2.png`, `_qa_room.json` — Council Room debate
- `_qa_after_rowclick.png` — row-click coin selection (working)
- `_qa_observations.json` — timer, links, console/network capture
