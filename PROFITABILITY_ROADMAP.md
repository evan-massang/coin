# Coin AI — Prioritized Profitability Roadmap

**Generated:** 2026-06-07 (Research-Director loop, cycle 8)
**Method:** multi-agent evidence audit (58 agents, 9 domains, 45 findings → **37 adversarially verified**) + 3 independent first-hand DB probes by the main loop. The synthesis agent died on a session limit; this roadmap is the human-in-the-loop reconstruction, re-grounded on first-hand numbers.

---

## The through-line (verified spine)

**The entire system optimizes a target the exit can never realize.**

- Selection/learning score a "win" as **peak gain ≥ 2x** (`max_gain_pct ≥ 100`).
- But **100% of 2x-winners (106/106) first draw down ≥ 45%** from entry — tripping the −45% hard stop *before* they moon.
- The stop doesn't even realize at −45%: of 532 deep-drawdown BUYs, the **median 5-min return is −56.5%** (it gaps through the stop on a 15s tick reading a stale 5m aggregate).
- The facets that drive conviction select for the *worst realized* coins: **conviction 72+ (BUY_STRONG) has the worst 5m return (−17.5%)** despite the highest peak-2x rate (14.4%). Momentum (weight 30) and organic are anti-predictive on realized return — they buy coincident pump tops.
- Net: **72% of BUYs are red within 5 minutes (median −22%)**, paper PnL bleeds, and none of it is durably measured (realized PnL is never written to the durable store; the paper ledger was wiped mid-audit by `/paper/reset`).

**Implication for sequencing:** more/better "selection" is NOT the top lever. The top levers are (1) optimize and measure **realized** PnL, (2) make winners **survivable** by the exit (and by better entry), then (3) recalibrate selection against realized outcomes. Everything else is downstream.

---

## Ranked roadmap (EV = profit impact × confidence ÷ effort)

| # | Opportunity | Domain | Impact | Conf | Effort | Status |
|---|-------------|--------|--------|------|--------|--------|
| 0 | Entry-timing instrumentation + shadow late-entry guard | selection/entry | High | High | — | **DONE — Verified** |
| 1 | Realign target PEAK→REALIZED + make realized PnL durable | data/measure | High | High | M | next |
| 2 | Make winners realizable: redesign the −45% stop (kills 100% of winners; gaps to −56%) | exit | High | High | M | next |
| 3 | Calibrate + enforce the entry-timing guard (don't buy spikes) | entry | High | Med | S→M | iter-2 |
| 4 | Recalibrate conviction → P(realized win) (BUY_STRONG is worst; overstates P(2x) 52–63pp) | calibration | High | High | M | |
| 5 | Re-fit facet weights vs realized PnL (momentum/organic anti-predictive) | selection | High | Med | M | |
| 6 | Reclaim 30% dead conviction weight (smartMoney+devReputation frozen) | selection | Med | High | S | |
| 7 | Re-derive position sizing from realized-calibrated prob (do NOT up-size BUY_STRONG) | sizing | Med | Med | S | |
| 8 | Recover the 30% blind 50/50 observation cycles (dumped to WATCH, never re-scanned) | observation | Med | Med | M | |
| 9 | Wire the backtester into the loop + out-of-sample splits (all thresholds fit on one 34h regime) | data/measure | Med | High | M | |
| 10 | Fallback exit for unpriceable coins (dead/rugged positions never exit) | reliability | Med | High | S | |
| 11 | Bound exit-tick starvation + unbounded in-memory Sets | reliability | Med | Med | S | |
| 12 | DB growth + O(n) `stats()` on the hot scoring path (silent decay) | reliability | Med | Med | S | |
| 13 | Council: evaluate candidates PRE-buy or stop paying for it (<3% coverage, 100% post-trade) | council | Low | High | M | |
| 14 | Council "confirm" is anti-predictive — unwire/retire | council | Low | High | S | |
| 15 | Gate always-on debate (burns compute for zero decision value) | council | Low | High | S | |
| 16 | Fix/clip 2 rubber-stamp seats (95–98% confirm) | council | Low | Med | S | |
| 17 | Surface entry run-up + first-5min drawdown per trade (the hidden #1 loss driver) | UX | Med | High | S | partial (run-up done) |
| 18 | One PnL source of truth (3 units in one panel; 2 accounts don't reconcile; 2 win-rates) | UX | Med | High | M | |
| 19 | Realized equity curve (Profit×Time caps at 40 lines vs 140 open) | UX | Med | Med | S | |
| 20 | Show closed-position exit reasons on the trade row | UX | Low | High | S | |
| 21 | Guard `/paper/reset` (confirm + auto-export; it wiped 253 positions mid-audit) | UX/reliability | Med | High | S | |

---

## Detail (evidence + experiment)

### TIER 0 — shipped this cycle
**0. Entry-timing instrumentation + shadow late-entry guard.** The late-entry "don't chase" guard had fired **0/19,414** times (it read the empty trade buffer; risk capped at 40 < 70 gate). Now fed real DexScreener `priceChange.m5/h1`; records `recentM5Pct`/`recentH1Pct` per signal; **shadow by default** (records + flags "would block", changes no verdict) to avoid the refuted "exit-if-red" mistake. **Verified live:** 102 fresh signals recorded the run-up; e.g. `$Ronaldo BUY_SMALL conv=69 m5=+222%` — caught buying a +222% top. (`entry.ts`, `lateEntry.ts`, `decisionCaps.ts`, `reasoning.ts`, +7 tests.)

### TIER 1 — foundation (optimize the right thing; make it real)
**1. Realign PEAK→REALIZED + durable realized PnL.** `setExit` (realized PnL → signals/learning) is dead code; the learning loop optimizes `max_gain_pct` (peak); the only realized ledger is the non-durable paper store, which `/paper/reset` wiped (253 positions) mid-audit. *Experiment:* write realized per-trade SOL to `signals.real_pnl_sol` at exit; switch `isWin`/learning objective to realized; re-run all selection stats on realized PnL and compare rankings.

**2. Make winners realizable — redesign the stop.** 100% of 2x-winners breach −45% first; the stop realizes at median −56% (stale-5m gap). *Experiment:* on the recorded price path, backtest realized PnL for stop variants — {no hard stop + time stop}, {−60%/−70%}, {real-time price instead of 5m aggregate}, {scale-out} — holding entry fixed; then jointly with #3.

**3. Calibrate + enforce the entry guard.** 72% red @5m; BUY_STRONG −17.5% @5m. Once `recentM5Pct` accumulates (~1 day), measure run-up→**realized** outcome; set the threshold where realized EV turns negative; flip `lateEntryEnforce`. *Hypothesis:* entering on pullbacks (not +X% spikes) shrinks the pre-2x drawdown so winners survive the stop — directly attacking the #2 knot from the entry side.

### TIER 2 — selection & calibration (after the target is realized)
**4. Conviction → probability.** Inversely calibrated (BUY_STRONG worst realized; overstates P(2x) by 52–63pp). *Experiment:* isotonic/Platt map conviction→P(realized win) on a holdout; report reliability diagram.
**5. Re-fit facet weights vs realized PnL.** Momentum (weight 30, ρ≈0.449 to peak) and organic are anti-predictive on realized return. *Experiment:* fit weights to realized PnL with out-of-sample splits; expect momentum down-weighted + an organic ceiling.
**6. Reclaim 30% dead weight.** smartMoney+devReputation are frozen constants on the free feed. Reallocate to facets that compute, or source real data.
**7. Sizing from realized prob.** BUY_STRONG is the *worst* realized bucket — do not up-size it; re-derive sizing from the #4 calibration (possibly inverted vs today).
**8. Recover blind cycles.** 30% of observation cycles end in a 50/50 verdict dumped to WATCH and never re-scanned. Re-scan survivors or extend observation.
**9. Backtester in the loop.** Every threshold is fit on one ~34h regime; the backtester never runs. Wire it in with time-held-out validation before any threshold change ships.

### TIER 3 — reliability
**10.** Exit silently skips stop AND time-stop for coins DexScreener can't price → dead/rugged positions never exit (capital stuck, PnL frozen). Add a price-independent time-stop.
**11.** Exit-tick starvation under load + unbounded in-memory Sets; the `ticking` guard hides cadence degradation. Bound + instrument.
**12.** Unbounded DB growth + O(n) full-table `stats()` on the hot scoring path → silent latency decay. Add indices / incremental stats / retention.

### TIER 4 — council (low profit impact; advisory only)
**13.** Council never evaluates a coin before it's bought (<3% BUY coverage; 100% of opinions land after the trade) — useless for entry. Evaluate candidates pre-buy or stop spending on it.
**14.** Council "confirm" is anti-predictive (confirmed coins win less than cautioned). Keep it out of decisions; investigate or retire.
**15.** Always-on debate burns compute for zero decision value (wired only to the dashboard). Make on-demand / gated.
**16.** 2 of 5 seats rubber-stamp (95–98% confirm). Remove or recalibrate.

### TIER 5 — UX / visibility (Objective #2)
**17.** Surface entry run-up (done) **+ first-5min drawdown** per trade — the hidden #1 loss driver.
**18.** One PnL source of truth: today three units in one panel, two PnL accounts that don't reconcile, two contradictory win-rates.
**19.** Realized equity curve; Profit×Time caps at 40 lines while ~140 positions are open → unreadable.
**20.** Show closed-position exit reasons on the trade row (captured, never displayed).
**21.** Guard `/paper/reset` — confirm + auto-export before wipe (it destroyed 253 positions mid-audit; PnL is unverifiable across resets).

---

## Hard constraints (unchanged)
Never lower the BUY conviction gate (replay: gate 40 ⇒ −136 SOL). Paper-only; never sign/trade/hold a key. AI is advisory; never overrides safety/risk/verdict. Ship behind shadow/measurement; "Verified" requires observed evidence, not code/tests alone.
