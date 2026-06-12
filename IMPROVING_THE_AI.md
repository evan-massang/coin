# IMPROVING THE AI — Consolidated Plan + Operator Prompt

**Generated:** 2026-06-12 · Synthesis of the full strategy review (code verified: typecheck clean, 255/255 tests, engine boots; spike-exit patch + sweep script delivered separately).

---

# PART A — THE PLAN

## The goal, stated honestly

Not "constant profit" — that doesn't exist. The target: **verified positive realized expectancy on paper, out-of-sample, across ≥2 market regimes, with drawdown ≤ 25%**, measured on a durable ledger. Smoothness comes from many small uncorrelated trades, regime gating, and cutting structural losers — never from win rate.

## The strategy: a two-sleeve barbell

**Sleeve A — HARVEST (~75% of paper capital).** Many fast, small wins. Memecoins spike violently and constantly; we bank the first spike and leave. Exit style: `firstSpike` (sell ~all at the swept-best multiple) — but ONLY if `spike_exit_sweep.ts` proves it beats the early-harvest ladder on both ordering bounds. Lives or dies on entry timing, not spike abundance.

**Sleeve B — MOONSHOT (~25%).** We do not predict 10–20x coins before entry — no amount of "long thinking" makes a newborn memecoin "sure," and research delay ruins the entry. Instead: every coin enters as a Harvest trade, and a position **graduates** to Moonshot only when post-entry evidence earns it (higher lows holding, smart wallets accumulating, attention still growing, deployer clean). The deep-research agents + council run **pre-graduation** (fixing the audit finding that 100% of council opinions land after trades).

## The drop plan (decided at entry, never mid-panic)

**Harvest drops = budgeted cost:** size so one stop ≈ 1–3% of the sleeve; accept gap risk via smaller size; time-stop stagnant coins; price-independent exit for unpriceable/rugged coins (roadmap #10 — today they never exit); circuit breaker: 5 consecutive stops ⇒ stand down, the meta died.

**Moonshot drops ≠ exit signal:** 100% of recorded 2x+ winners drew down ≥45% first — the drawdown is the toll. Exit on **thesis violation only**: dev sells, LP changes, distribution, smart money leaving, attention rollover, or no progress in N days. Survive the drawdown structurally: tiny size, wide/no price stop, never average down, pull initial capital at 2–3x and ride the rest.

**Portfolio:** hard 75/25 capital split; any single coin ≤ 2% of total book; correlation cap (5 coins in one meta = 1 bet); per-sleeve PnL tracked separately so we know which half actually earns.

## Build order (each phase has a GATE — do not advance without passing it)

**P0 — Measurement.** Durable append-only realized-trades journal (survives `/paper/reset`); guard the reset (confirm + auto-export); one PnL source of truth; realized equity curve; exit reason + first-5-min drawdown per closed row. *Gate: 7 unbroken days of ledger; all panels reconcile.*

**P1 — Realized labels.** Replay every recorded signal through the exit engine → `realizedLabel`; learning consumes realized only; keep peak as the exit-quality diagnostic. *Gate: 100% labeled; realized expectancy by conviction bucket reported.*

**P2 — Entry timing (biggest Harvest lever).** Calibrate + enforce the run-up guard (`maxEntryRunupM5Pct` sweep, then `lateEntryEnforce=true`); test entry-on-stabilization (pullback + higher low) and staged entry in replay; shadow-first. *Gate: red-at-5-min ≤ 55% (from 72%); realized PnL/trade improves out-of-sample.*

**P3 — Exits.** Run `scripts/research/spike_exit_sweep.ts`; adopt the winning config (or keep ladder if nothing wins both bounds). Fix unpriceable-coin exit. Test constant-$-risk (half size, wider stop) and incubation window vs the −40% stop. Fresher stop price; log stop slippage. *Gate: ≥30% of peak-2x coins realize ≥1.5x (today 0%); zero stuck positions.*

**P4 — Sleeve mechanics.** Tag positions `harvest|moonshot`; separate exit rule-sets and PnL; graduation trigger (runner promotes on evidence); capital split, correlation cap, circuit breaker; council/research re-wired to pre-graduation only. *Gate: live paper trades carry sleeve tags; per-sleeve expectancy visible; council coverage of graduations = 100% pre-decision.*

**P5 — Data depth.** Helius key → holder concentration, dev wallet, bundles, deployer graph go live; seed smart-money wallets from own ledger winners; facets that still can't compute get weight 0. *Gate: real values on >80% of gate-passers.*

**P6 — Refit + calibration.** Facet weights refit vs realized PnL, walk-forward only; conviction → calibrated P(win) (isotonic), reliability diagram; sizing = capped fractional Kelly from calibrated prob; never upsize BUY_STRONG until calibration earns it. *Gate: OOS profit factor > 1.0; calibration within ±7pp per bucket.*

**P7 — Regime + anti-decay.** Regime health from realized expectancy of ALL signals; halve size / stand down in dead regimes; backtester wired as CI for every threshold change; rolling 7-day expectancy monitor with auto-revert to last-good settings. *Gate: one full regime transition handled without manual intervention.*

**P8 — Real money (pre-committed, written before looking at results).** ≥300 paper trades on final config; positive expectancy in ≥2 regimes; max DD ≤ 25%. Then tiny manual size, log real vs paper fills, recalibrate slippage. Kill criteria pre-committed. *Until every gate passes: paper only.*

## Standing rules (never break)

Paper-only until P8 gates pass; never hold keys or sign. Never lower the BUY conviction gate (replay: gate 40 ⇒ −136 SOL). Evidence, not vibes — "Verified" means observed in the live DB/app. Every shipped change carries a number it must beat and is reverted if it doesn't. Risky changes ship shadow-first. Manual-execution reality check: if alert→sold-in-Phantom exceeds ~30s, Harvest paper results are fiction — measure it.

---

## Status tracker (the AI updates this)

| Phase | Status | Gate result | Date |
|-------|--------|-------------|------|
| Setup (patch + sweep) | **done** | 395/395 tests + typecheck green. Sweep ran on 3,390 BUYs — but only after fixing a bug in the delivered script: `max_drawdown_pct` is a PEAK-relative positive magnitude (featureStore.ts:83), not entry-relative signed; correct entry-relative trough = peakMult·(1−dd). Corrected sweep: firstSpike ≥2x beats the early-harvest baseline on both bounds, BUT a no-ladder control beats every spike config (opt −6.83%/pess −10.24% vs baseline −8.13%/−13.96%), and the trend is monotone toward "never harvest" — a horizon artifact (sim final = 1h price; live time-stop = 4h; measured decay 5m→1h is −6.5%→−10.7% mean, so the sim flatters holding). **exitStyle NOT flipped** — stays earlyHarvest; ladder redesign deferred to P3 with a horizon-correct simulator. Bonus finding: the roadmap claim "100% of 2x-winners breach the −45% stop" is FALSE under the verified dd convention — only 38.4% (66/172) breach −40% from entry; the "100%" was a tautology of the peak-relative dd definition (dd ≥ 50% for any 2x peak by construction). `exitOutcomeBounds` (backtester.ts:85) carries the same wrong mapping — research-only, no live path; fix scheduled with P1's realized-label replay. | 2026-06-12 |
| P0 Measurement | not started | — | — |
| P1 Realized labels | not started | — | — |
| P2 Entry timing | not started | — | — |
| P3 Exits | not started | — | — |
| P4 Sleeves | not started | — | — |
| P5 Data depth | not started | — | — |
| P6 Refit/calibration | not started | — | — |
| P7 Regime/anti-decay | not started | — | — |
| P8 Real-money gates | locked until all above pass | — | — |
