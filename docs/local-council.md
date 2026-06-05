# Running the AI Council on local models (Ollama)

The Council Room can run entirely on **local models** — no cloud, no API keys.
Five seats, one model each, each given a different analyst role over the same
evidence. It stays advisory only: it never trades, moves funds, changes a score,
or overrides the Safety Gate / Risk Engine.

## Roster (default local)

| Seat | Role | Model | Vendor |
|---|---|---|---|
| Qwen 3B | Bull Analyst | `ollama/qwen2.5:3b` | Alibaba |
| Llama 3.2 | Narrative Analyst | `ollama/llama3.2:3b` | Meta |
| Gemma 2 | Risk Analyst | `ollama/gemma2:2b` | Google |
| Phi 3.5 | Contrarian | `ollama/phi3.5` | Microsoft |
| Qwen 1.5B | Lead Reviewer | `ollama/qwen2.5:1.5b` | Alibaba |

## One-time setup

1. **Install Ollama** (Windows): `winget install Ollama.Ollama` or the installer
   from <https://ollama.com>. It runs a local server on `http://127.0.0.1:11434`.
2. **Pull the models:**
   ```
   ollama pull qwen2.5:3b
   ollama pull llama3.2:3b
   ollama pull gemma2:2b
   ollama pull phi3.5
   ollama pull qwen2.5:1.5b
   ```
3. **Protect RAM** (16 GB / CPU-only): keep one model resident at a time —
   `setx OLLAMA_MAX_LOADED_MODELS 1` and `setx OLLAMA_NUM_PARALLEL 1`, then restart Ollama.
4. **Point the council at the local roster + enable it:**
   ```
   tsx scripts/setup-local-council.ts
   ```

## Run

`npm start` → open the dashboard → run **AI research** on a token (Council Room
panel / CONFIG) → the 5 seats deliberate → click **ENTER THE ROOM** to see the
exact evidence each model received, what each seat was asked, what it answered,
and the blended consensus. Per-seat accuracy is journalled and resolved against
outcomes over time (bounded dynamic weighting).

## Why local seats bypass OpenCode

OpenCode is a *coding agent* — it advertises tools on every model call, and
tool-less local models (Gemma/Llama/Qwen/Phi) reject that with HTTP 400. So
`ollama/*` seats talk to Ollama's OpenAI-compatible `/v1/chat/completions`
endpoint directly (`src/aiComputer/ollamaCouncil.ts`) — exactly what OpenCode
would proxy to, minus the tools. OpenCode is still used for genuinely *remote*
seats (cloud models via `opencode auth login`), and is not spawned when every
active seat is local. See [[council-opencode]] context.

## Notes for CPU-only machines

- No dedicated GPU here, so seats run **sequentially** with a 90 s per-seat
  timeout — a full 5-seat round is ~1 minute. That's fine: the engine's own
  observation window already makes decisions non-instant.
- **Reasoning models don't fit** this use: DeepSeek-R1 (1.5B) "thinks" for too
  many tokens on CPU and times out. Use direct-answer models (the roster above).
- Quick smoke test of one seat: `tsx scripts/test-local-seat.ts "ollama/gemma2:2b@risk_analyst"`.
- Full real run + dashboard: `DATA_DIR=./.verify-data PORT=3014 tsx scripts/run-local-council.ts`.
