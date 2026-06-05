# Research Cycle 05 — Why isn't it profitable? (selection vs. risk management)

**Date:** 2026-06-05
**Status:** 2 fixes deployed (forward-verifying), 3 hypotheses refuted, 1 candidate shelved.
**Headline:** On the free DexScreener feed, the engine **cannot pick winners** — every
momentum-qualifying pump.fun token looks identical at entry. The only edge available is
**risk management** (stop-loss + correct sizing). Real selection edge needs the PAID
per-trade feed. This is a decision for the operator, surfaced — not silently worked around.

---

## Starting state (measured)

- Paper wallet: 30 SOL → **totalPnL −0.220 SOL (−0.73%)**, win rate 11% (closed), 18 closed
  / 43 open. `bestTradePct +156%`, `worstTradePct −97.5%`.
- Journal: 9,890 signals; verdicts AVOID 8,403 / WATCH 1,398 / BUY_SMALL 62. Selective. Good.
- Live weather endpoint after the Cycle-5 fix: `RISK_OFF — "engine win rate low 6%"`.

## Fix 1 — market weather was poisoned by never-traded tokens (DEPLOYED)

`fetchMarketWeather` was fed `signals.stats().winRate` — computed over **every** resolved
signal, ~1,115 of which are WATCH/AVOID tokens the engine **never traded** (12 wins ⇒ 1.1%).
That forced a permanent false `RISK_OFF` on every decision, and the 0.35 risk-off multiplier
floored **every BUY to TINY (~0.1%)** size. The first paper BUY ($Tone) collapsed to
`risk_tier=NONE` for exactly this reason.

**Fix:** `signalsRepo.buyStats()` — win-rate over **resolved BUYs only**; a cold-start guard
(`minWeatherSamples`, default 20) keeps weather macro-only until there are enough *real*
trades; `entry.ts` and the `/api/market` panel both feed `buyStats()`.

**Result (correct, not magic):** weather now reads `RISK_OFF "win rate low 6%"` — i.e. it
reflects the engine's **real** BUY performance (6% hit 2x), not the never-traded poison. The
brake re-engages on real evidence, as designed. Sizing is *correctly* cautious given a 6–9%
hit rate. Conviction gate (55), caps, and safety gates untouched.

## Fix 2 — stop-loss (DEPLOYED)

`stopLossPct` (default 0.45) added to the exit engine between the time-stop and trailing-stop.
Fires `SELL_EXIT_NOW` only **below entry**, so it can never cut a winner. Motivation comes
straight from the data below: 6 of 65 traded tokens went `gain=0 → drawdown ≥60%` (one to
−97.5%). The stop-loss caps those at −45% instead of letting them bleed to the 4h time-stop.

**Quantified** (faithful drawdown-aware model, 49 trades at the gate; mean PnL/trade as an
ordering range optimistic … pessimistic):

| stopLoss | mean PnL/trade |
|---|---|
| off | −14.6% … −14.6% |
| **0.45 (deployed)** | **−11.0%** … −22.4% |
| 0.35 | −9.0% … −19.4% |
| 0.30 | −7.9% … −17.8% |

The optimistic bound (peak-first ordering) is the representative case for the deep losers —
they had `gain=0`, i.e. they *only* fell, so peak-first = trough-first for them and the stop
**unambiguously** caps the damage (+3.6pts/trade at 0.45). The pessimistic bound is the
honest risk: a stop can cut a token that dips *then* runs. Tighter stops (0.30–0.35) help the
expected case more but raise that risk — **not tuned on 4 winners; 0.45 stays, 0.35 is a
forward A/B candidate.** This quantification is only possible because of the new faithful
backtester (`backtestExits` / `exitOutcomeBounds`) — the old peak-only `ladderCapture`
ignored `maxDrawdownPct` and couldn't score a stop-loss at all.

---

## The core finding — selection is a coin-flip on free data (REFUTED: "we can pick winners")

Traded + resolved postmortem (65 trades, 4 winners, 61 losers; deep = ≥60% drawdown):

| facet (mean) | winners | shallow-lose | DEEP-lose |
|---|---|---|---|
| organic | 69.8 | 70.8 | **71.5** |
| momentum | 88.3 | 75.8 | **83.0** |
| graduation | 4.0 | 3.2 | 4.0 |
| lateEntryRisk | 20.0 | 15.3 | 20.0 |
| conviction | 59.0 | 58.8 | 59.0 |

**No facet separates winners from losers** — deep losers have *higher* organic and momentum
than shallow ones. Every BUY is the same monoculture: `conv=59, mom≈85, org≈70, grad=4,
late=20, [safety-unknowns], cap "N unknown safety items⇒cap 59"`. PLOP (winner, +125%) is
indistinguishable at entry from pumpfun (−90%) and Puffins (−89%). With no Helius/Birdeye
keys, holder-concentration and smart-money data are absent, so every momentum-qualifying
pump.fun token scores identically. **Selection among gate-passers is random.**

### Sub-hypotheses tested

1. **Momentum floor improves selection** — REFUTED. The conviction gate already selects
   high-momentum tokens; an added `momentum≥floor` filter leaves the traded set unchanged
   (45 trades, win 8.9%, pnl −9.59 at every floor 0…70). Momentum is saturated among
   gate-passers.
2. **Deep losers have a pre-trade signature to gate on** — REFUTED (table above).
3. **graduation / lateEntryRisk are dead/broken signals** — REFUTED. They're correctly
   flat because the engine snipes at token *birth* (~$4k mcap = 6% of graduation; you're
   early ⇒ late-risk low). Not applicable at this entry point, not a bug.

### Conviction is hard-capped at 59

Every BUY is capped at conviction 59 by `N unknown safety items⇒cap 59` (no holder/safety
data). BUY_STRONG (72) is unreachable ⇒ every BUY is BUY_SMALL ⇒ smallest sizing tier.
Same root cause: missing paid data.

---

## Exit tuning is second-order (CANDIDATE, shelved — would overfit)

Ladder-allocation sweep on the 65 trades (trailing fixed 0.35; only the 4 winners differ):

| ladder | pnl/notional |
|---|---|
| current 40/30/20 @ 2/3/5x | −16.15 |
| front 60/25/15 | −15.92 |
| front 70/20/10 | −15.81 |
| all-out 100% @ 2x | −15.52 |

Peak distribution: **≥1.5x = 5, ≥2x = 4, ≥3x = 1, ≥5x = 0.** The 3x/5x rungs almost never
fire — winners top out near 2x, so front-loading captures marginally more (+0.6 SOL over 65
trades). But the effect rides on **4 data points** and stays deeply negative. **Not deployed**
— that would overfit 4 winners. Revisit once ≥20 winners accumulate.

---

## The arithmetic of a coin-flip

With ~200%-capturing winners and −45% stops, break-even needs ≈18% win rate
(`0.18·200 ≈ 0.82·45`). Current real win rate is **6–9%**. No exit tweak closes a 2× gap;
only **better selection** (⇒ paid feed) or trading **less** does. The weather fix now
enforces "trade small while the hit rate is low," which is the correct response.

## Decisions surfaced to the operator

1. **Fund the PumpPortal per-trade feed** (`subscribeTokenTrade`, 0.01 SOL/10k events) to
   unlock smart-money, holder concentration, and real-time organic — the only path to a
   selection edge. Everything else is risk management around a coin-flip. (See
   `docs/research/cycle-04.md` and memory `trade-data-paid-feed`.)
2. Or accept paper-only research mode: the engine is now *correctly* cautious (small,
   stop-lossed bets) and near break-even, which is the honest ceiling on free data.

## Forward checks (next session)

- Re-measure paper PnL + `buyStats().winRate` after more trades resolve under the stop-loss
  + weather fix. Expect: fewer −80%/−90% closes (stop-loss), realized losses tighter.
- Build a **faithful backtester** (drawdown- + stop-loss-aware, with ordering bounds) so exit
  tuning can be evidence-based instead of peak-biased — the current model ignores
  `maxDrawdownPct` and can't score a stop-loss. (Started this cycle.)
