# Research Cycle 07 — Reality Audit & rebuild (the "everything is 59" peg)

**Date:** 2026-06-05
**Method:** adversarial multi-agent audit (4 parallel verifiers + synthesis), every claim
re-derived against the live DB/code; then fixes shipped + LIVE-verified (Finding 11 culture).

The operator's 11-point "Reality Audit & Rebuild Plan" was verified rather than assumed. Net:
the binding defect was a miscalibrated **conviction cap**, not model intelligence; and a real
(if modest) **momentum edge** exists in the free feed — correcting the Cycle-5 "coin-flip" call.

---

## What was VERIFIED real, and FIXED (live)

### 1. Conviction was pegged at 59 → BUY_STRONG impossible (Findings 3+4). FIXED.
100% of 336 traded BUYs sat at conviction 59. Root cause: `decisionCaps` UNKNOWN_CAP fired on
`safety.unknownCount>=2`, and `safetyGate` counted ALL unknown checks — including non-fatal,
**structurally-unavailable-on-the-free-feed** ones (holderConcentration, bundle, rugcheck,
devMovement, freshWallets). So "we didn't pay for holder data" was a permanent conviction
ceiling. BUY_STRONG (72) was mathematically unreachable; conviction had zero spread to calibrate.

First attempt (count only FATAL unknowns) shipped, then **live verification caught it failing** —
the cap message was `2 unverified fatal-safety items⇒cap 59`: mint AND freeze authority are
themselves UNKNOWN (public RPC rate-limited for newborns; RugCheck hasn't indexed a seconds-old
token). And *resolving* authorities is the wrong fix: pump.fun bonding-curve tokens hold mint
authority in the curve PDA (not null) → resolving returns `revoked=false` → a fatal gate FAIL →
would AVOID every pump.fun token. So on a pump.fun-only free feed, the safety-unknowns are
**structural and permanent.**

**Fix shipped:** the safety-unknown conviction cap is removed; it now only sets the
`safety-unknowns` flag (transparency). Protection is unchanged — the safety GATE still AVOIDs
confirmed-bad tokens, `LOW_COVERAGE_CAP(49)` still requires real DexScreener evidence to BUY, and
the risk engine still shrinks size when blind (keeps the all-unknowns count).
**Verified offline** (`verify-discrimination`: stays selective, 200/2533 — not buy-everything) and
**live** (fresh BUYs now reach conviction 67, was a flat 59). Commits `49a0011`, `947981a`.

### 2. A momentum edge exists in free data (Finding 7) — Cycle-5 "coin-flip" CORRECTED.
On 336 traded BUYs, `scores.momentum` separates 2x winners: AUC 0.646, lift +14.4. A
**momentum≥85 gate ~doubles the 2x hit-rate** (6.5%→14.3%, permutation p=0.0074, holds on a
chronological out-of-sample split). Backtest on 2,788 resolved: floor 85 → 80 trades, 15.0% win,
pnl/notional −13 (vs 238 / 9.2% / −51 with no floor). The Cycle-5 "no facet separates" was an
artifact of (a) the 59 peg (no spread) and (b) `devReputation`/`smartMoney` being constant stubs.
**Shipped:** `minMomentumForBuy` setting (CONFIG knob), **default 0 = OFF** — the audit sample is
one 3.7h window / 22 winners, so live use must wait for ≥1 week multi-regime data; flip to 85 then.
Commit `8e15e8a`.

---

## Deferred — with evidence-based reasons (NOT shipped blind, per Finding 11)

- **Graduation drag** (caps conviction below BUY_STRONG for newborns): graduation is near-constant
  (~4) and barely discriminative, so it uniformly suppresses conviction. BUT dropping it would
  raise conviction for winners AND losers alike → could make the engine *less* selective (more
  BUYs cross 55) and prematurely enable bigger BUY_STRONG sizing while the momentum edge is still
  single-window. Needs its own backtest before touching. Its mild drag is the conservative choice now.
- **`tokens.created_at` "fabricated"** (Findings 1/7 maturity): a non-issue for THIS feed — we only
  see pump.fun newborns (subscribeNewToken), so `created_at ≈ first_seen ≈ real birth` and there is
  no coin-age variance to recover. The real maturity lever is the observe-window (now a tunable
  setting `observeWindowSec`/`minObserveSec`), not "buy older coins."
- **Analytics hygiene** (store null for unknown facets instead of 50/60): risky — the backtester
  recomputes conviction from stored `scores{}` and has no per-facet confidence column, so nulling
  them would break replay. Low behavioral value (the live blend already drops unknowns). Defer.
- **Council abstain + route-to-BUYs** (Findings 5/6): the council is advisory-only with 0.3%
  coverage (6/336 traded BUYs) and shows no edge on trades — low impact for the surgery. Defer.

## Already handled this session (Findings 8/9 — observability)
Paper Wallet panel, Profit×Time chart, live Reasoning Feed + downloadable report, batch-priced
exits (stop-loss firing near −45% not −85%), weather cold-start fix.

## Honest state
The cap fix removes a structural defect that jammed the whole conviction/calibration/sizing system
— necessary, not sufficient. The momentum edge is real but modest (~14% win) and single-window;
the "buys ~1.5 min late" loser tail (−27%@5m) still dominates per-trade expectancy, which is why
even momentum≥85 backtests to −13, not positive. Profitability remains a forward goal gated on:
confirming the momentum edge over ≥1 week multi-regime data (then enabling the floor), and the
free-feed ceiling (the paid per-trade feed is the path to lifting the base rate, not a prerequisite).
