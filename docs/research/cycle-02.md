# Research Cycle 02 — Made the engine honest; isolated the real bottleneck

**Role:** Research Director. **This cycle SHIPPED a verified fix** (with deploy authority granted) and **forward-verified it on live data.** No unverified behavioral change was deployed.

---

## What shipped (verified)

**Conviction-hygiene fix** — designed via a 7-agent adversarial workflow (3 designs → skeptic critiques → synthesis), then implemented with the exact failure-mode tests the critiques demanded.

- `scoring/conviction.ts` — `computeConviction` is now **confidence-aware**: a facet is blended in only if its confidence ≥ floor. Unknown facets (organic on <8 trades, smartMoney with no tracked wallets, devReputation with no data) are **dropped from the blend** instead of anchoring conviction at a frozen 45/50/60. New `realCoverage()` measures how much *real* evidence (excl. social/hype) actually counted. **Absent confidence defaults to 1 → every legacy caller + the backtester reproduce old verdicts exactly.**
- `agents/scoreAgents.ts` — organic/momentum return `unknown` below `minBuysToDecide` (8); smartMoney `unknown` with no tracked wallets; devReputation `unknown` until devSold is known. The old `0.4` mid-band (which a 5-sniper cluster could exploit) is removed.
- `scoring/decisionCaps.ts` — new `low-coverage⇒cap 49` when real coverage < `minRealCoverage` (0.5). **The BUY gate stays at 55** (Cycle-1 guardrail).
- `engine/entry.ts` — builds the per-facet confidence map and threads it + the floor/coverage settings into `decide()`. Displayed scores unchanged (dashboard still shows nominal facets).
- Settings (NOT auto-tunable — structural safety): `minBuysToDecide` (8, floored at 8 — 5 was proven to re-import the thin-evidence bug), `convictionConfidenceFloor` (0.5), `minRealCoverage` (0.5).
- Also shipped: **`regime` persisted per signal** (migration v8 + `classifyRegime` at decision time) for per-regime research; dashboard **idle-state explainer**.

**Verification:** `npm test` **187 passed** (+14 new). New tests prove: a 5-distinct-buyer cluster on <8 trades is EXCLUDED; social+hype alone can't clear the gate; a full-coverage active vector CAN reach BUY; absent-confidence = legacy behaviour. typecheck + lint + build green.

---

## Forward verification (83 live signals, post-fix)

| metric | before fix | after fix |
|---|---|---|
| organic score | **45 for 100%** (frozen "insufficient") | dropped from conviction when unknown |
| WATCH signals | conv ~43, *pretending* to judge | **all capped at 49 with a `low-coverage` flag — honest** |
| conviction max | 47 | 49 (the coverage cap) |
| BUYs | 0 | 0 |

**The fix did exactly what it should:** the engine stopped emitting confident-looking opinions on evidence it doesn't have. Every thin token now carries an auditable `low-coverage` cap instead of a fake conviction. A token that *genuinely* reached ≥8 trades with strong organic+momentum *would* now earn a real BUY — the mechanism is correct.

**But it also isolated and quantified the real bottleneck:**

> **0 of 83 post-fix tokens reached ≥8 observed trades.**

The problem is **observation coverage, not scoring.** The scoring is now honest; it simply has nothing well-observed to score. Cause: `maxWatched=50` (feed-safe — the free PumpPortal feed drops streams when over-subscribed), most slots spent on tokens that die in seconds, and active candidates either never get a slot or aren't observed long enough to accumulate 8 trades.

---

## Cycle 3 proposal — fix observation coverage (DESIGNED, not yet deployed)

> Authority: designed + ready; needs forward verification that it produces *well-timed* BUYs before deploy. Staged behind a setting per the adversarial review.

**P-cov1 — Smart watch-slot recycling.** Keep `maxWatched=50` (feed-safe). Replace the bare watched-Set with `Map<mint,{watchedAt,lastTradeAt,buys}>` + a bounded `pending` queue. `rebalanceWatch`: admit fresh survivors prioritized by launch signals (initialBuySol/marketCap/rugcheck cleanliness); evict **demand-driven only** — a slot past min-tenure (~25s) with `buys<1` and oldest `lastTradeAt`, and only when `pending` is non-empty. Spends the 50 slots on tokens actually trading, so active candidates reach ≥8 trades inside the normal window.

**P-cov2 — Trailing-window momentum (resolves the deflation tension).** `momentum.ts:34` computes `buyerVelocityPerMin = uniqueBuyers / (now−start)`, so observing longer to accumulate trades *deflates* the velocity that would justify the BUY (the review flagged this as the real unresolved tension). Fix: compute velocity over a fixed trailing window (e.g. last 60s) so coverage and velocity stop fighting. Then a bounded observe-extension for still-trading tokens becomes safe.

**Staging + verification:** behind `adaptiveWatchEnabled`, gated on a measured **organic-distinctness lift** (organic distinct values ≫ 1) and a backtest that it stays **selective** (does not buy >50% — re-run `scripts/research/verify-discrimination.ts`). Allocator invariant tests: never exceeds `maxWatched`; no eviction when `pending` empty; a still-trading token isn't finalized prematurely.

**Guardrail reaffirmed (Cycle 1):** do **not** lower the BUY gate to force trading — replay showed gate 40 ⇒ −136 SOL.

---

## Cycle verdict
Cycle 1 found *why* the engine never buys. Cycle 2 **fixed the dishonest half** (frozen scores anchoring conviction) and proved, on live data, that the remaining blocker is **observation depth**, not scoring — turning a vague "it doesn't work" into a precise, testable next experiment. That is the operating model working: investigate → ship the verified part → isolate the next bottleneck with evidence → propose the next experiment.
