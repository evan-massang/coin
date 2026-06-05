# Research Cycle 01 — Why Coin AI never buys

**Role:** Research Director (Claude Code). **Mode:** investigate → experiment → propose. **No code was deployed.**
**Method:** read-only queries over the live DB (`data/sniper.sqlite`, 8,061+ signals) + one counterfactual replay through the real backtester + live dashboard/API inspection.

---

## Headline finding

**Across 8,061 signals the engine has issued ZERO buys — ever.** Conviction maxes at **47** (the BUY gate is 55). The whole downstream stack (paper trading, council, risk, exits) has never had anything to act on: paper wallet 30 SOL, **0 fills**; `decisionReady = 0`.

Root cause is **upstream, not the gate**: the engine scores tokens **before enough trades are observed**, so the scoring inputs are frozen at neutral defaults and conviction can never rise.

---

## Evidence

### Domain 5 — Confidence calibration
- Conviction over all 8,061 signals: **min 0, max 47, avg 31.6**. Histogram: `<40` = 6,932, `40–50` = 1,129, `≥50` = **0**.
- Every resolved signal sits in one bin (0–50) → conviction is **not predictive because it has no range**. (`scripts/research/cycle1.ts`)

### Domain 6 — Evidence quality (winner vs loser facet averages, n: 8 winners / 451 losers)
- `organic` = **45.0 for winners AND losers** (distinct values = **1**, i.e. 100% identical).
- `smartMoney` = **50.0** (distinct = 1). `devReputation` = **60.0** (distinct = 1).
- Only `momentum` (lift +1.8) and `graduation` vary at all. **Three of the highest-weighted conviction inputs carry zero discriminative signal.** (`cycle1b.ts`)

### Root cause (code-grounded)
- `engine/organicVolume.ts:26` → returns `score: 45, "insufficient trade data"` when **`buys.length < 5`**. organic = 45 for **100%** of signals ⇒ **every token is scored on fewer than 5 observed buys.**
- Mechanism: ~553 survivors/session but the trade-stream watch cap is **50** (`engine/entry.ts maxWatched`), so ~90% of tokens only ever carry their seeded creator buy (1 trade) → `<5 buys` → organic frozen at 45.
- `agents/coordinator.ts:43` → agents that can't compute fall back to **50** (smartMoney has no tracked wallets) and devReputation defaults to 60.
- Top conviction caps that fire: `organic<55 ⇒ cap 59` on **6,868** signals (85%), `N unknown safety items ⇒ cap 59` on thousands. (But the caps are moot — raw conviction never reaches 47, far below the 59 cap.)

### Domain 4 — Missed opportunities (the cost, real money)
Tokens the engine **saw, judged safe, and skipped** as `WATCH_ONLY` at conviction 41–44:

| token | verdict | conv | max gain | safety |
|---|---|---|---|---|
| $maybutt | WATCH_ONLY | 43 | **+944%** | 100 |
| $SUNDOG | WATCH_ONLY | 42 | **+368%** | 100 |
| $AWD | WATCH_ONLY | 44 | **+320%** | 89 |
| $NINJA | WATCH_ONLY | 43 | **+277%** | 100 |
| $WIF | WATCH_ONLY | 41 | **+180%** | 100 |

Every one has `organic = 45` — indistinguishable from the noise by the current scores.

### Domain 7 — Council, Domain 1 — Product
- Council: 4 opinions, **0 resolved** — effectively unused (no BUYs trigger it; only the manual test debates ran). Can't audit accuracy yet.
- Product: `paperTrading` enabled but **0 fills**; `decisionReady`/`highConviction` tiles permanently 0; the Council Room, paper panel, and decision feed are empty **not because of UI bugs but because nothing upstream ever fires.**

### Domain 10 — Meta / data sufficiency
- Only **5.6%** of signals resolve a forward price path (453/8061); **0** resolved BUYs. AVOID signals aren't price-tracked at all.
- `regime` is **not persisted per signal** → per-regime performance is currently un-researchable from history.
- ⇒ Most quant findings here are **directional**; the root-cause finding is **structural/definitive** (not statistical).

---

## Experiment 1 — counterfactual gate replay (the important negative result)

Fed all 459 resolved signals through the real backtester (`learning/backtester.ts`) under the current gate vs lowered gates (`scripts/research/experiment1.ts`, notional 1 SOL/trade):

| variant | trades | win% | PnL/notional | max DD% |
|---|---|---|---|---|
| baseline (gate 55/72) | 0 | 0.0 | 0.00 | 0 |
| gate 45/60 | 3 | 0.0 | −0.46 | 51 |
| **gate 40/55** | **459** | 5.2 | **−136.68** | 99 |
| gate 40/55 + organicFloor 40 | 459 | 5.2 | −136.68 | 99 |

**Interpretation:** the obvious "just lower the gate" fix is **refuted**. At gate 40 the engine buys *everything* (459) and loses catastrophically — the 5% winners can't pay for the 95% losers because **the scores can't tell them apart**. Lowering the gate removes the only filter without adding signal. *The lever is upstream discrimination, not the threshold.*

---

## Proposals (evidence-backed — each needs human approval before any change)

> Authority: I may inspect/experiment/propose. I may NOT deploy, trade, or modify production without approval. These are recommendations.

### P1 — Score tokens only after ≥5 observed buys (fix the root cause) · **priority: HIGH**
- **Hypothesis:** conviction is starved because `organic` (and the trade-derived facets) are frozen at the `<5 buys` fallback for ~90% of tokens; raising trade-data coverage before scoring will restore conviction's range and discriminative power.
- **Experiment to validate (forward — cannot backtest, stored organic is already frozen):** raise effective coverage (e.g. lift/queue the `maxWatched` watch cap so more survivors get a trade stream, and/or require `buys ≥ 5` before emitting a non-WATCH verdict). Measure: distinct `organic` values (target ≫1), conviction distribution (target some ≥55), and whether winners separate from losers on `organic`/`momentum`.
- **Metrics:** organic distinct count; % of signals with conviction ≥55; winner−loser `organic` lift.
- **Risk:** low — read-only/paper engine; more watching = more PumpPortal subscriptions (was previously capped to avoid the free-feed dropping the stream — so test incrementally, e.g. 50→100, watch for trade-capture loss).

### P2 — Do NOT lower the conviction gate (guardrail / negative result) · **priority: HIGH**
- **Evidence:** Experiment 1 — gate 40 ⇒ −136.68 PnL, buys all 459, 99% drawdown. Record this so a future tuner (or the bounded auto-tuner) never lowers `minConvictionBuySmall` to "make it trade." Gate tuning is only valid **after** P1 restores discrimination.

### P3 — Persist `regime` + `coverage` per signal · **priority: MEDIUM**
- **Why:** Domains 5/8 can't be researched historically without it. Add `regime` (and confirm `coverage`) on `signals` at decision time. Pure research-enablement; no behavior change.

### P4 — Wire or down-weight `smartMoney` / `devReputation` · **priority: MEDIUM**
- **Evidence:** both frozen (50 / 60, distinct=1) yet carry weights 18 / 12 — they dilute conviction with constant noise. Either feed real data (tracked wallets / creator history) or reduce their weight until they compute.

### P5 — Product: explain the idle state · **priority: LOW**
- The paper/council/decision panels read as "broken" when they're actually idle. Surface "0 buys — every token scored on <5 trades (low coverage)" so the operator sees the real reason. (Confirms the plan's paper-visibility note, with the deeper cause.)

---

## Next cycle
1. If P1 approved: run it incrementally and re-measure organic distribution + conviction range (forward A/B).
2. Backfill `regime`/`coverage` (P3) → unlock per-regime confidence calibration.
3. Re-audit the council once real BUYs start resolving (Domain 7).
4. Investigate the high `unknown safety items` rate (keyless RugCheck coverage) — a secondary conviction drag.

**Cycle 1 verdict:** the engine isn't under-AI'd — it's **under-observed**. It decides before it has watched, exactly the hypothesis in the plan. The highest-leverage work is data coverage, not more models or a looser trigger.
