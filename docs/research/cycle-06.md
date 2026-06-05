# Research Cycle 06 — Exit-timing: the "cut if red at 15m" rule (REFUTED)

**Date:** 2026-06-05
**Method:** adversarial multi-agent workflow (4 parallel analyses + a gated synthesis), each
independently querying the live `signals` journal.
**Verdict: DO-NOT-DEPLOY.** An evidence-backed refutation, not "thin data."

---

## The hypothesis (from scouting)

The forward price path now records (`price_5m/15m/1h`). Scouting found the engine's BUYs are
down a **median −27% within 5 min / −32% by 15 min** (it buys late), and that tokens **red at
15m → 0 of 72 ever hit 2x** while the only winners were green at 15m. That suggested a
**time-bounded early exit**: "if a position is still red at ~15 min, cut it" — losing ~0
winners while cutting losers earlier than the −45% stop / 4h time-stop.

## Why it's wrong (3 independent gates failed)

1. **It cuts the few big winners.** The winners that matter *dip then rip*: `BTP` (−33% @15m →
   peaked **+307%**) and `MUKU` (−11% @15m → **+189%**) are red at 15m. The rule force-exits
   them. `TRULL` (−47% @5m → +141%) is the same pattern earlier. With only ~9–11 winners total,
   losing the biggest 2 is catastrophic. **No threshold fixes it** — at −10% it still cuts 2,
   at −20% still cuts BTP.

2. **The "0 winners lost" was survivorship bias.** 6–7 of 11 winners have **no 15m sample at
   all**, so the rule is blind to ~55% of winners; the clean result was measured over only
   2–5 observable winners. As the live DB grew during the analysis (200→207 BUYs), new winners
   resolved *into* the red bucket — the pro-deploy "sweep"/"false-positive" agents had read a
   stale snapshot.

3. **It adds no protection the −45% stop doesn't already give.** 43% of red@15m losers are
   already past −45% at 15m, where the existing stop-loss fires **earlier and at a better
   price**. Modeled realized loss on red@15m: **−40.5% (rule) vs −27.3% (current)** — ~13 pp/
   trade *worse*. (Many shallow reds recover toward entry under the current engine; the rule
   force-realizes the 15m trough.)

The quantify + skeptic agents put PnL at **~−12 to −18 pp/trade worse**. Two agents initially
*supported* the rule on a clean 0-winners snapshot; the synthesis re-derived on a fresh
snapshot and both gates (winners-lost ≈ 0; sample/overlap) failed.

## Data-fidelity defect found + fixed

The agents flagged that for many rows `price_5m == price_15m` exactly. A direct check:
**488 of 537 (91%)** rows with a 15m sample had `price_5m == price_15m`, and **222 (41%)** had
`price_15m == price_at_alert`. Cause: this session's 6 debugging restarts made the tracker
first-price many signals when they were *already* >15 min old, so every due horizon slot got
written with the **same** current price — the 5m/15m distinction was fiction for most rows.

**Fix (`featureStore.ts`):** sample only *near* each horizon (`price_5m` in [5,12) min,
`price_15m` in [15,25), `price_1h` ≥60) — never backfill a stale price into a passed slot. A
NULL (honestly missing) sample beats a wrong one. With continuous 30 s batch pricing, live
signals always land inside these windows; future path data will carry genuine multi-horizon
samples. (Existing rows keep the artifact — filter `price_5m != price_15m` for clean ones.)

## What this teaches (carry-forward)

- **Winners dip then rip.** The rare 2x+ tokens (BTP +307%, MUKU +189%, TRULL +141%) go red
  first. Any aggressive early/tight exit is high-leverage *downside* — it kills the few coins
  that pay for everything. This is the opposite of the intuition that "down fast = dead."
- **Open question (needs more winners):** does the −45% stop-loss itself cut some dip-then-rip
  winners (TRULL would have been stopped at −45% before its +141%)? Loosening the stop bleeds
  losers more; this is a genuine tension to study once ≥20–30 winners with clean path data
  exist. Not actionable yet.
- **The exits are left UNCHANGED.** The current ladder + 45% stop + trailing + 4h time-stop
  beat this rule. The discipline held: a strong-looking scouting signal was killed by
  adversarial verification (cf. the gate-40 replay in `trade-data-paid-feed`).
