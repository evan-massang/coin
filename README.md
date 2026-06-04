# AI Meme-Coin Sniper — Desktop Signal Engine + Read-Only Wallet Observer

A **local, desktop-only** Solana meme-coin **signal engine** — **not** an auto-trading bot.
It reads public data, scores pump.fun / Solana tokens, and shows
`BUY_SMALL` / `BUY_STRONG` / `WATCH_ONLY` / `AVOID` / `TOO_LATE` signals in a local web
dashboard at `http://localhost:3000`. Via a **read-only** observer of your **public** wallet
address, it auto-detects what you bought, tracks PnL, and coaches the exit with
`SELL_TRIM` / `SELL_EXIT_NOW` alerts. **You trade manually in Phantom/Jupiter.**

## Hard guarantees (non-negotiable)

- ❌ Never auto-buys. ❌ Never holds a private key or seed phrase. ❌ Never signs or sends a transaction.
- ✅ Consumes only **public** data + your **public** wallet address.

## Three runtime modes (independent; can run together)

1. **Live Signal** — alerts only; you trade manually.
2. **Read-Only Wallet** — observe your real public wallet, track real positions/PnL.
3. **Paper Trading** — the bot runs its own *simulated* wallet (fake buys/sells from its own
   signals) to test itself and learn which rules work. **Simulation only: never keys, never
   signing, never on-chain.**

## Quick start

```bash
npm install
npm run dev      # → http://localhost:3000
```

Open the dashboard, go to **Settings**, paste your **public** Phantom address (never a seed
phrase), and optionally add free API keys (Helius / Birdeye / Anthropic / RugCheck).

## Scoring = Gate → Score → Cap → Verdict

Safety is a hard gate, not a weight: a token that fails the safety gate is `AVOID` no matter
how strong every other signal is. AI narrative is **confirmation only** — it can never override
safety or force a BUY. See the Ultraplan in the project notes for the full decision logic.

## How it's built

- `src/store` — SQLite (better-sqlite3) + typed settings + repositories.
- `src/sources` — PumpPortal (realtime), Solana RPC, DexScreener, RugCheck, CoinGecko (SOL/USD), LunarCrush.
- `src/engine` — safety gate (Stage-0/1), organic-volume, momentum, graduation, exit engine, copy tracker, smart money, position manager, the entry pipeline.
- `src/scoring` — conviction (weighted), late-entry risk, decision caps (the gate→cap→verdict core).
- `src/wallet` — read-only observer: tx parser, position detector, PnL.
- `src/paper` — Mode-3 sim wallet, risk-sized fake fills, reuses the exit engine.
- `src/learning` — feature store + outcome tracker, performance analyzer, adaptive thresholds (bounded auto-tune), backtester.
- `src/hype` — heuristic narrative scorer + optional prompt-cached Claude judge.
- `src/dashboard` — express + websocket + the 8-tab UI (`public/`).
- `src/alerts` — dispatcher (loud BUY/SELL vs quiet AVOID/WATCH), desktop notifier, sound.

```bash
npm install && npm run build   # clean
npm test                       # 84 tests
npm run lint                   # clean
npm run dev                    # → http://localhost:3000
```

Set `NO_ENGINE=1` to run the dashboard standalone (no live feed). API keys are optional and
entered in the Settings tab; the engine degrades to free data sources without them.

> ⚠️ **Risk note:** ~98% of launches are rug / wash / manipulation. This engine improves odds,
> timing, and exit discipline — it does **not** guarantee profit. Not financial advice. High
> risk of total loss is the norm here.
