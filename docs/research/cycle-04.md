# Research Cycle 04 — The engine was blind: live trades are a PAID feed. Fixed it free; it now trades.

**Role:** Research Director. **Outcome: the engine issued its FIRST BUY ever and executed a paper trade — after 8,000+ signals of never trading.** Forward-verified live.

---

## The breakthrough finding (deeper than Cycles 1-3)

Cycles 1-3 fixed real downstream issues (frozen scores, dishonest conviction, slot logic) but the engine still never bought. The reason, found by probing the live feed + reading the docs:

> **PumpPortal's per-trade stream (`subscribeTokenTrade`) is a PAID feature — 0.01 SOL per 10,000 events. Only `subscribeNewToken` is free.**

The engine subscribes to token trades on the **free** connection → PumpPortal silently delivers **nothing**. Evidence:
- Direct feed probe (`scripts/research/probe-feed.ts`): subscribed to fresh tokens, received **0 buy/sell messages** (only the create stream + the "Successfully subscribed" ack), and **no unknown txType** either — so it's not a parse bug, the data simply never comes.
- The `trades` table has **0 rows** with `source='token'` across the entire history.

So **the engine has been running blind on seed-only data the whole time** — every token scored on its 1 seeded creator-buy → organic always "insufficient" (<5 buys) → conviction starved → **0 BUYs, ever.** No scoring/slot/gate fix could have worked; the trade data was never there. (Cycle 3's slot-recycling addressed a non-bottleneck — `recycled=0`, the 50 slots never even fill. Kept it: it's safe, demand-driven, and useful once data flows.)

---

## The fix (free, verified)

**Derive organic/momentum from DexScreener aggregates** (`src/engine/dexMomentum.ts`). DexScreener exposes per-token rolling **5-minute buy/sell counts + volume + price change** for free, and the engine already polls it for prices. Crucially, because the window is DexScreener's own rolling 5m, **observing longer does NOT deflate momentum** (the tension that blocked Cycle 3's window-extension).

- `dexSignals(snap)` → organic (buy-pressure), momentum (txn/price velocity), `confident`. **Confidence is gated on TXN ACTIVITY, not liquidity** — pump.fun bonding-curve tokens report `liquidity=$0` on DexScreener (liquidity is in the curve), but a check of 15 recent tokens showed **13/15 had real txn data** (6-36 txns/5m).
- `entry.ts scoreToken`: fetch the DexScreener snapshot; when `dex.confident`, use its organic/momentum (with full confidence) so the confidence-aware conviction (Cycle 2) finally has **real evidence** to blend → conviction can clear the gate.
- **Risk floor** (`risk/microfishRisk.ts`): a BUY that already cleared the safety gate + conviction gate now takes at least `minRiskPct` (paper), instead of compounding multipliers rounding it to 0/NONE — otherwise valid BUYs never execute and profitability can't be measured.

Tests: **196 pass** (+`dexMomentum`, +`watchAllocator` invariant tests). typecheck + lint + build green.

---

## Forward verification (live)

| event | result |
|---|---|
| organic distinct values | 1 → **5** (real DexScreener data flowing) |
| conviction max | 47 → **59** (clears the 55 gate for the first time) |
| **first BUY ever** | **$Tone** · conv 59 · 102 txns/5m · 100% buy-pressure · momentum 71 |
| selectivity | **1 BUY vs 52 AVOID/WATCH** — not buying everything |
| **paper trade executed** | balance 30 → **29.962 SOL** · position held (755k tokens of `5KfEep…pump`) |

**The full pipeline functions for the first time:** scan → score on real trade-flow → selective BUY → risk-size → execute paper trade → hold position.

---

## The profitability loop (now unblocked — forward & ongoing)

Now that trades execute, the loop is: **measure paper win-rate / PnL as positions resolve → fix the weakest link → repeat.** Honest constraints:
- Each paper position resolves over **~1 hour** (price path) — profitability is a **forward, multi-hour+ measurement**, not a single-session guarantee. Meme trading is adversarial; no fix makes it certainly profitable.
- The known levers to iterate next, in order: (1) **selection** — are DexScreener-confident BUYs actually winners? reweight facets by resolved outcome; (2) **exits** — tune the profit-ladder/trailing-stop against resolved price paths (backtestable); (3) **sizing** — once win-rate is known, replace the flat `minRiskPct` floor with outcome-calibrated sizing; (4) **regime** — the regime is currently biased by the historical no-buy state and will normalize as trades flow.
- **Guardrail (Cycle 1):** never lower the conviction gate to force trades — replay proved gate 40 ⇒ −136 SOL.

**Cycle verdict:** the project's core blocker was never the AI or the scoring — it was a **missing paid data feed**, worked around for free. The engine has gone from *structurally unable to trade* to *trading selectively on real data* in one session. Profitability is now a measurable, iterable forward goal rather than an impossibility.
