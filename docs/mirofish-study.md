# MiroFish Study — what we borrow, what we don't

> Source: <https://github.com/666ghj/MiroFish> (AGPL-3.0, by Shanda Group).
> Studied to inform the **Graph Intelligence Layer** and the operator dashboard —
> *not* to copy code or its product. This note records what MiroFish actually is,
> which ideas transfer to a read-only Solana meme-coin signal engine, and which
> ideas we deliberately reject.

## 1. What MiroFish actually is

MiroFish is a **multi-agent prediction engine**: it builds "high-fidelity digital
simulations of real-world scenarios" by extracting seed information and simulating
the interaction of *thousands of autonomous agents*, each with "independent
personalities, long-term memory, and behavioral logic." You give it a question
(public opinion, a policy, a literary "what happens next", a market) and it
*rehearses the future in a digital sandbox*.

Domain: **general scenario prediction** — public-opinion/social dynamics, literary
analysis, financial forecasting, policy testing. It is **not** a crypto tool and
not a real-time market scanner.

Architecture (from the repo):

| Stage | What it does |
|---|---|
| **Graph Building** | Seed extraction → memory injection → **GraphRAG** construction |
| **Environment Setup** | Entity-relationship extraction, persona generation, agent config |
| **Simulation Engine** | Auto-parses the prediction goal, dynamic *temporal* memory updates |
| **Report Generation** | A **ReportAgent** with an interactive toolset writes the analysis |
| **Deep Interaction** | Chat with the simulated agents |

Stack: Python (~58%) + Vue (~41%), Node 18+, Python 3.11–3.12, OpenAI-compatible
LLMs (recommends Qwen-plus), **Zep Cloud** for agent memory, **OASIS** (CAMEL-AI's
social-simulation engine), `uv`/`npm`, Docker.

## 2. The transferable *philosophy* (what we borrow)

We are a different animal — a local, read-only, real-data signal engine — so we
borrow **ideas, not code**. Four ideas transfer cleanly:

1. **A graph is the reasoning substrate, not a number.**
   MiroFish reasons over a GraphRAG of entities and relationships. Our meme
   scanner historically reduced a token to a single *conviction score*. The new
   **Graph Intelligence Layer** (`src/graph/graphIntelligence.ts`) builds, per
   token, a small entity graph — `TOKEN · DEV · BUYERS · CLUSTER · SMART_MONEY ·
   NARRATIVE · KNOWN_RUG · UNVERIFIED` — so the operator sees *relationships*
   (did the deployer dump? is this a bundled cluster? did smart money enter?),
   not just a 0–100 number.

2. **Many independent agents, then synthesis.**
   MiroFish runs many agents and a `ReportAgent` synthesizes them. We already had
   a multi-agent coordinator (`src/agents/coordinator.ts`, `Promise.allSettled` +
   per-agent timeout, never throws). The Graph Intelligence Layer is the
   *synthesis* step — our analog of the ReportAgent — turning agent outputs into
   **bull/bear evidence with weights**, a **"why"** explanation, and a verdict the
   human can audit.

3. **Evidence over opinion.**
   The product question becomes *"why does the engine believe — or doubt — this
   token?"* not *"what's the score?"*. The dashboard's **Why This Token**,
   **Evidence Feed (bull ▲ / bear ▼)** and **Conflict** panels are the direct
   expression of this; the engine must show its work.

4. **Temporal memory / state.**
   MiroFish does "dynamic temporal memory updates." Our analog is the
   **Observation State machine** (`DISCOVERED → OBSERVING → MATURE →
   DECISION_READY → ARCHIVED`), the **coverage** metric ("how much of the picture
   we actually have"), and the **Observation Timeline** — plus the persistent
   scam-memory graph (deployer reputation, rug fingerprints, wallet clusters) in
   local SQLite.

## 3. What we deliberately do **not** borrow

- **Society simulation.** MiroFish *simulates* thousands of fictional agents to
  predict a future. We do the opposite: we **observe real on-chain behaviour**
  (PumpPortal trades, RugCheck, holders, liquidity). Simulating a crowd of fake
  buyers would be fabricated data — the one thing this project forbids.
- **The heavy stack.** Python/Vue/Docker/OASIS/Zep-Cloud is the wrong shape for a
  local, dependency-light TypeScript engine. We keep everything **local**: SQLite
  for memory (not Zep Cloud), no external simulation engine, dependency-free
  canvas for the UI.
- **LLM-as-decider.** MiroFish's agents *are* the prediction. For us the LLM /
  "AI Computer" is **research and confirmation only** — it gets a small narrative
  weight and **can never override the Safety Gate or change a verdict**. Safety
  and liquidity remain hard, non-AI facts.
- **Anything that touches money.** Unchanged invariants: never store a private
  key or seed phrase, never sign or send a transaction, never auto-buy a real
  wallet; paper trading is pure simulation. The subsystems that already encode
  these rules — **Safety Gate, MiroFish Risk Engine, Learning Engine, Wallet
  Observer, Paper Trading, AI Computer** — are kept *as-is*; the Graph
  Intelligence Layer sits *between observation and scoring* and adds explanation,
  it does not replace any safety logic.

## 4. Resulting pipeline

```
New token → Observation (multi-agent coordinator: safety/liquidity/holder/dev/
            bundle/organic/momentum/narrative/weather)
          → Confidence (conviction + coverage: how complete is the picture?)
          → Graph Intelligence (entities + bull/bear evidence + "why" + timeline)
          → Scoring (Gate → Cap → Verdict, unchanged)
          → Risk (MiroFish dynamic sizing — advisory / paper-only)
          → Decision (AVOID / WATCH_ONLY / BUY_SMALL / BUY_STRONG / TOO_LATE / SELL_*)
```

The goal is an **Evidence-Driven Meme-Coin Intelligence Platform** — a tool that
shows *why* — not an opaque "AI coin picker."

## 5. Naming note

The reference project is **MiroFish** (`666ghj/MiroFish`). Earlier internal work
mislabeled it "MicroFish"; comments and UI strings were corrected. The internal
`riskMode` enum value `"microfish"` and the filename `microfishRisk.ts` are kept
stable on purpose, to avoid breaking already-persisted user settings.
