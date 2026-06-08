# Project Athena — Build Status (overnight 2026-06-07 → 06-08)

Honest done / partial / not-done per phase. Everything below is committed + pushed
to `main`, tests green at every commit, and the engine is **running live** on the
final build (dashboard at http://127.0.0.1:3000).

## ✅ DONE (built, tested, verified live)
- **Phase 4 Humanity / 5 Virality / 6 Outside-Crypto / 7 Cultural-Strength** —
  pure, unit-tested agents (`src/attention/*Agent.ts`) + `attentionAgent` composite.
- **Phase 2/3 ResearchAgent** (`src/attention/researchAgent.ts`) — free, read-only
  multi-source collector. **Backbone = Google News RSS + Wikipedia** (reliable here);
  Reddit/DDG via a real browser are opt-in (this machine has an HTTPS-inspection
  layer that blocks their raw fetch; browser uses ignoreHTTPSErrors).
- **Phase 1/16 Autonomous research queue** (`attentionService.ts`) — auto-researches
  shortlisted (WATCH/BUY, never AVOID) coins; dedupe, TTL, single-worker, cache.
- **Phase 8/9 Local-LLM judge** (`llmJudge.ts`) — asks the Athena attention questions
  via a LOCAL Ollama model (set `attentionLlmModel`, e.g. `qwen2.5:14b`); falls back
  to the deterministic heuristic agents if no model. Free, private.
- **Phase 18 Attention pillar in conviction** — new `attention` facet (weight 18,
  settings-tunable). **Confidence-gated**: dropped from the blend unless the coin was
  actually researched, so blind newborns are unaffected; it only moves conviction
  for coins with real web evidence.
- **Phase 17 Auto re-score** — `rescoreWithAttention()` re-decides a coin when its
  research completes; re-signals if verdict/conviction shifts (WATCH↔BUY↔AVOID).
- **Phase 10–13 Explainability** — attention research surfaces in the dashboard
  reasoning feed (👁) with the humanity/virality/outside-crypto/culture breakdown,
  narrative, top reasons, and evidence count.
- **Phase 19 Meme graveyard / persistence** — `attention_research` table (migration
  v10) + `AttentionRepo`; research is upserted on completion and the in-memory cache
  warms from it on boot, so attention now SURVIVES RESTARTS and accrues history.
- **Phase 15 Evidence explorer (API)** — `GET /attention` (the graveyard) +
  `GET /attention/:mint` (full evidence for a coin) make every score inspectable.

**Live verification:** engine auto-researched real coins — `$WORLDCUPLIFE` (attn 77),
`$Teletubby` (outside-crypto 69 — real-world meme correctly detected), `$GLITCH`
(attn 79, conf 70%). Confidence-gating confirmed working.

## 🟡 PARTIAL
- **Phase 15 Evidence explorer UI** — the API (`/attention`, `/attention/:mint`) is
  done and the feed shows the breakdown; a dedicated click-through dashboard PANEL
  is not built yet (inspect via the JSON routes for now).
- **Phase 16 Multi-pass** — single pass + TTL re-research (recheck) is in; staged
  depth-escalation (deep browser pass for high-conviction) / exit-validation not yet.
- **Humanity on FRESH coins** — News/Wikipedia give strong real-world/virality
  signal but weak grassroots-human signal for brand-new coins (Reddit/Twitter are
  blocked for raw fetch here; the browser path is flaky behind the cert-inspection
  layer). For established memes the read is strong.

## ❌ NOT DONE (deliberately deferred — honest)
- **Phase 14 Live browser monitoring** ("watch the AI browse") — we run headless
  News+Wiki by default; no live-browser viewport in the dashboard.
- **Phase 19 outcome-linking** — the graveyard now persists every researched coin
  (done), but it doesn't yet JOIN to realized trade outcomes for "what did high-
  attention coins actually do" learning. The data is captured for that next.
- **UI-TARS-desktop** — separate from this; not installed (no capable GPU, needs a
  paid cloud model — see the prior plan).

## How to turn the dials
In CONFIG / settings: `attentionEnabled` (on), `weightAttention` (18 → raise toward
25–35% to make attention more dominant once you trust it), `attentionLlmModel`
(set an Ollama model to upgrade from heuristic to LLM reasoning), `attentionUseBrowser`
(try Reddit/DDG via browser), `attentionTtlMin` (re-research cadence).

## How to verify yourself
- `npm test` — full suite (green).
- `npx tsx scripts/research/_athena_probe.ts <name> <SYMBOL>` — live attention read.
- Dashboard → reasoning feed: look for the 👁 attention rows.

---

# Decision Authority + Data-Truth (overnight 2026-06-08, continued)

The night's headline: **attention now GATES executed buys** (it used to land after the
buy — "watching, not controlling"), and a standing audit proves it can't be bypassed.
Plus the data-truth audit's worst mislabels are fixed and guarded against regression.

## ✅ DONE (built, tested, Verified Working live)
- **Readiness Gate (Phase 21)** — a would-be BUY is held at WATCH until attention
  research has RUN for the coin; the re-score then recomputes MiroFish risk sizing and
  EXECUTES the attention-informed buy. Keys on *researched*, NOT *positive attention*,
  so footprint-less newborns research-to-empty and are bought on fundamentals (no
  deadlock). Default ON, only active when attention is enabled + weighted.
  *Verified:* `rescore_BUY_SMALL == attention_gated_buy`, `scored_BUY_* == 0` (no buy
  bypassed), and live coins (GN, Gus) were held at WATCH then upgraded to open
  positions after research.
- **Decision authority record (Phase 17/22)** — `GET /api/authority`: per executed
  paper buy, which intelligence backed it (attention score/confidence + research time)
  + the invariant `noSilentBypass`. *Verified:* gateOn=true, 60/60 recent buys
  researched, noSilentBypass=true.
- **Decision-influence breakdown (Phase 18)** — `src/debug/decisionAuthority.ts`:
  per-facet conviction contribution, `attentionInfluencePct`, and legacy-vs-Athena
  divergence (does attention flip the verdict?).
- **Data Truth Validator (Phase 0)** — `GET /api/data-truth`: standing provenance
  checks (equity/PnL identities, per-fill ledger vs cash-derived realized, conviction
  range, coin-age capture health, attention feed⊆store). Caught a real ledger drift
  (Δ ~0.73 SOL) the moment it ran.
- **Automated self-audit (Phase 15)** — `GET /api/athena-audit` + a log line every
  5 min: one PASS/WARN/FAIL verdict rolling up data-truth + authority. *Currently
  WARN* (0 failures; the one warning is the known per-fill ledger drift).
- **Critical mislabels fixed (Phase 0/16), Playwright-verified:**
  - **AGE column** now shows TRUE coin age from DexScreener `pairCreatedAt`; falls back
    to honestly-marked `~recency` (tooltip) when no DEX pair exists. (Was: signal
    recency mislabeled as coin age — the audit's only CRITICAL.)
  - **Observation tiles** un-swapped: CONVICTION (score, no bogus %), TIER, OBSERVED
    (watch time, not coin age).
  - **Evidence-lean meter** can no longer claim "evidence supports a position" when the
    verdict is WATCH/AVOID — it now reads "bullish lean — but verdict is X (gates/caps
    overrode)", which also surfaces the gate's effect.
  - **Liquidity chip** uses the configurable `minLiquidityUsd`, not a hardcoded $3000.

## 🟡 OPEN QUESTION (the real one)
Does the gate HELP profitability? Equity is ~breakeven (−1.9%, win-rate ~10% with rare
big winners — the classic meme distribution). The binding constraint remains ENTRY
TIMING, and the gate adds research latency before entry. The attention bet is that
research improves *which* coins we enter. **This needs forward outcome data** — the
engine is running with the gate on, persisting attention + outcomes; evaluate once
enough gated buys resolve.

## How to check the authority/truth state
- `GET /api/athena-audit` — one verdict (PASS/WARN/FAIL) + the detail.
- `GET /api/authority` — per-buy "who authorized this" + noSilentBypass.
- `GET /api/data-truth` — the provenance checks.
- Engine log: grep `athena-audit:` for the 5-min verdict.
