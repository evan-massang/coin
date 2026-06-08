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

**Live verification:** engine auto-researched real coins — `$WORLDCUPLIFE` (attn 77),
`$Teletubby` (outside-crypto 69 — real-world meme correctly detected), `$GLITCH`
(attn 79, conf 70%). Confidence-gating confirmed working.

## 🟡 PARTIAL
- **Phase 15 Evidence explorer** — the feed shows evidence count + reasons + the
  breakdown, but there's no click-through "inspect every scraped post" UI yet.
- **Phase 16 Multi-pass** — single pass + TTL re-research is in; the staged
  deep-dive / recheck / exit-validation passes are not separated out yet.
- **Humanity on FRESH coins** — News/Wikipedia give strong real-world/virality
  signal but weak grassroots-human signal for brand-new coins (Reddit/Twitter are
  blocked for raw fetch here; the browser path is flaky behind the cert-inspection
  layer). For established memes the read is strong.

## ❌ NOT DONE (deliberately deferred — honest)
- **Phase 14 Live browser monitoring** ("watch the AI browse") — we run headless
  News+Wiki by default; no live-browser viewport in the dashboard.
- **Phase 19 Meme graveyard** (historical memory of every researched coin for
  cross-comparison) — not started.
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
