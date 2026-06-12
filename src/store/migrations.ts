import type { Database } from "better-sqlite3";

// ─────────────────────────────────────────────────────────────────────────────
// Schema migrations. Each entry bumps PRAGMA user_version. Migrations run in
// order, exactly once, inside a transaction. Tables (Part 5):
//   settings, tokens, trades, signals, positions, wallets,
//   paper_wallet, paper_positions, paper_trades,
//   learning_features, learning_suggestions, setting_change_log, backtest_runs
// Nested structures (scores, reasons, exit plans) are stored as JSON text.
// ─────────────────────────────────────────────────────────────────────────────

interface Migration {
  version: number;
  up: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: /* sql */ `
      CREATE TABLE IF NOT EXISTS settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tokens (
        mint          TEXT PRIMARY KEY,
        name          TEXT,
        symbol        TEXT,
        creator       TEXT,
        uri           TEXT,
        pool          TEXT,
        created_at    INTEGER,
        first_seen_at INTEGER NOT NULL,
        last_snapshot TEXT
      );

      CREATE TABLE IF NOT EXISTS trades (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        mint         TEXT NOT NULL,
        trader       TEXT,
        side         TEXT NOT NULL,
        sol_amount   REAL,
        token_amount REAL,
        signature    TEXT,
        at           INTEGER NOT NULL,
        source       TEXT NOT NULL DEFAULT 'token'
      );
      CREATE INDEX IF NOT EXISTS idx_trades_mint ON trades(mint, at);
      CREATE INDEX IF NOT EXISTS idx_trades_trader ON trades(trader, at);

      -- §1.10 journal: every signal/alert emitted, with forward price path.
      CREATE TABLE IF NOT EXISTS signals (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        mint                 TEXT NOT NULL,
        symbol               TEXT,
        at                   INTEGER NOT NULL,
        verdict              TEXT NOT NULL,
        conviction           REAL NOT NULL,
        scores               TEXT NOT NULL,
        reasons              TEXT,
        flags                TEXT,
        caps                 TEXT,
        price_at_alert       REAL,
        price_5m             REAL,
        price_15m            REAL,
        price_1h             REAL,
        max_gain_pct         REAL,
        max_drawdown_pct     REAL,
        exit_reason          TEXT,
        hypothetical_pnl_sol REAL,
        real_pnl_sol         REAL
      );
      CREATE INDEX IF NOT EXISTS idx_signals_mint ON signals(mint, at);
      CREATE INDEX IF NOT EXISTS idx_signals_verdict ON signals(verdict);

      -- Real observed positions (source='wallet').
      CREATE TABLE IF NOT EXISTS positions (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        mint                 TEXT NOT NULL,
        symbol               TEXT,
        source               TEXT NOT NULL DEFAULT 'wallet',
        status               TEXT NOT NULL DEFAULT 'OPEN',
        entry_price_usd      REAL NOT NULL,
        entry_at_ms          INTEGER NOT NULL,
        token_amount         REAL NOT NULL,
        initial_token_amount REAL NOT NULL,
        sol_invested         REAL NOT NULL DEFAULT 0,
        cost_basis_usd       REAL NOT NULL DEFAULT 0,
        realized_pnl_usd     REAL NOT NULL DEFAULT 0,
        peak_price_usd       REAL NOT NULL DEFAULT 0,
        last_price_usd       REAL,
        exit_plan            TEXT,
        closed_at_ms         INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(source, status);

      -- Observed wallet (read-only) + watched copy-trading wallets.
      CREATE TABLE IF NOT EXISTS wallets (
        address  TEXT PRIMARY KEY,
        kind     TEXT NOT NULL DEFAULT 'copy',
        label    TEXT,
        added_at INTEGER NOT NULL,
        score    TEXT
      );

      -- Paper sim wallet (singleton row id=1).
      CREATE TABLE IF NOT EXISTS paper_wallet (
        id                    INTEGER PRIMARY KEY CHECK (id = 1),
        starting_balance_sol  REAL NOT NULL,
        balance_sol           REAL NOT NULL,
        created_at            INTEGER NOT NULL,
        updated_at            INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS paper_positions (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        mint                 TEXT NOT NULL,
        symbol               TEXT,
        source               TEXT NOT NULL DEFAULT 'paper',
        status               TEXT NOT NULL DEFAULT 'OPEN',
        entry_price_usd      REAL NOT NULL,
        entry_at_ms          INTEGER NOT NULL,
        token_amount         REAL NOT NULL,
        initial_token_amount REAL NOT NULL,
        sol_invested         REAL NOT NULL DEFAULT 0,
        cost_basis_usd       REAL NOT NULL DEFAULT 0,
        realized_pnl_usd     REAL NOT NULL DEFAULT 0,
        peak_price_usd       REAL NOT NULL DEFAULT 0,
        last_price_usd       REAL,
        exit_plan            TEXT,
        closed_at_ms         INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_paper_positions_status ON paper_positions(status);

      CREATE TABLE IF NOT EXISTS paper_trades (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        mint                    TEXT NOT NULL,
        side                    TEXT NOT NULL,
        price_usd               REAL NOT NULL,
        sol_amount              REAL NOT NULL,
        token_amount            REAL NOT NULL,
        realized_pnl_sol        REAL NOT NULL DEFAULT 0,
        remaining_token_amount  REAL NOT NULL DEFAULT 0,
        reason                  TEXT,
        at                      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_paper_trades_mint ON paper_trades(mint, at);

      -- §1.12 feature store.
      CREATE TABLE IF NOT EXISTS learning_features (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        mint             TEXT NOT NULL,
        at               INTEGER NOT NULL,
        verdict          TEXT NOT NULL,
        scores           TEXT NOT NULL,
        entry_price_usd  REAL,
        exit_price_usd   REAL,
        max_gain_pct     REAL,
        max_drawdown_pct REAL,
        hold_ms          INTEGER,
        exit_reason      TEXT,
        realized_pnl_sol REAL,
        source           TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_features_source ON learning_features(source, at);

      CREATE TABLE IF NOT EXISTS learning_suggestions (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        at        INTEGER NOT NULL,
        kind      TEXT NOT NULL,
        setting   TEXT NOT NULL,
        from_val  REAL NOT NULL,
        to_val    REAL NOT NULL,
        rationale TEXT NOT NULL,
        status    TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS idx_suggestions_status ON learning_suggestions(status, at);

      CREATE TABLE IF NOT EXISTS setting_change_log (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        at       INTEGER NOT NULL,
        setting  TEXT NOT NULL,
        from_val TEXT,
        to_val   TEXT,
        by       TEXT NOT NULL,
        note     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_change_log_at ON setting_change_log(at);

      CREATE TABLE IF NOT EXISTS backtest_runs (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        at               INTEGER NOT NULL,
        settings         TEXT NOT NULL,
        trades           INTEGER NOT NULL,
        win_rate         REAL NOT NULL,
        total_pnl_sol    REAL NOT NULL,
        max_drawdown_pct REAL NOT NULL,
        best_trade_pct   REAL NOT NULL,
        worst_trade_pct  REAL NOT NULL,
        avg_hold_ms      INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    up: /* sql */ `
      ALTER TABLE signals ADD COLUMN risk_tier TEXT;
      ALTER TABLE signals ADD COLUMN suggested_risk_pct REAL;
      ALTER TABLE signals ADD COLUMN max_position_sol REAL;
      ALTER TABLE signals ADD COLUMN market_weather TEXT;
      ALTER TABLE signals ADD COLUMN source_agreement REAL;
      ALTER TABLE signals ADD COLUMN red_flags TEXT;
    `,
  },
  {
    version: 3,
    up: /* sql */ `
      CREATE TABLE IF NOT EXISTS creator_history (
        creator    TEXT PRIMARY KEY,
        launches   INTEGER NOT NULL DEFAULT 0,
        rugs       INTEGER NOT NULL DEFAULT 0,
        winners    INTEGER NOT NULL DEFAULT 0,
        first_seen INTEGER NOT NULL,
        last_seen  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS token_fingerprints (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        mint        TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        norm_name   TEXT,
        symbol      TEXT,
        at          INTEGER NOT NULL,
        outcome     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_fp_fingerprint ON token_fingerprints(fingerprint);
      CREATE INDEX IF NOT EXISTS idx_fp_norm ON token_fingerprints(norm_name);

      CREATE TABLE IF NOT EXISTS wallet_cluster_edges (
        a            TEXT NOT NULL,
        b            TEXT NOT NULL,
        co_buys      INTEGER NOT NULL DEFAULT 0,
        rug_overlaps INTEGER NOT NULL DEFAULT 0,
        last_at      INTEGER NOT NULL,
        PRIMARY KEY (a, b)
      );
    `,
  },
  {
    version: 4,
    up: /* sql */ `
      CREATE TABLE IF NOT EXISTS replay_events (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        mint             TEXT NOT NULL,
        at               INTEGER NOT NULL,
        verdict          TEXT NOT NULL,
        scores           TEXT NOT NULL,
        safety_pass      INTEGER NOT NULL,
        unknown_count    INTEGER NOT NULL,
        max_gain_pct     REAL,
        max_drawdown_pct REAL,
        hold_ms          INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_replay_at ON replay_events(at);
    `,
  },
  {
    version: 5,
    up: /* sql */ `
      CREATE TABLE IF NOT EXISTS ai_audit_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        at              INTEGER NOT NULL,
        task_id         TEXT,
        action_type     TEXT NOT NULL,
        url             TEXT,
        selector        TEXT,
        allowed         INTEGER NOT NULL,
        reason          TEXT,
        screenshot_path TEXT,
        approved        INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_ai_audit_at ON ai_audit_log(at);
    `,
  },
  {
    version: 6,
    up: /* sql */ `
      ALTER TABLE signals ADD COLUMN state TEXT;
      ALTER TABLE signals ADD COLUMN coverage REAL;
      ALTER TABLE signals ADD COLUMN conviction_tier TEXT;
      ALTER TABLE signals ADD COLUMN evidence_count INTEGER;
      ALTER TABLE signals ADD COLUMN bull_count INTEGER;
      ALTER TABLE signals ADD COLUMN bear_count INTEGER;
    `,
  },
  {
    version: 7,
    up: /* sql */ `
      CREATE TABLE IF NOT EXISTS council_opinions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        at             INTEGER NOT NULL,
        mint           TEXT NOT NULL,
        symbol         TEXT,
        member_id      TEXT NOT NULL,
        label          TEXT,
        role           TEXT,
        model          TEXT,
        score          INTEGER,
        recommendation TEXT,
        rationale      TEXT,
        outcome        TEXT,
        max_gain_pct   REAL
      );
      CREATE INDEX IF NOT EXISTS idx_council_mint ON council_opinions(mint);
      CREATE INDEX IF NOT EXISTS idx_council_member ON council_opinions(member_id);
    `,
  },
  {
    version: 8,
    up: /* sql */ `
      ALTER TABLE signals ADD COLUMN regime TEXT;
    `,
  },
  {
    version: 9,
    up: /* sql */ `
      -- Per-paper-position profit trajectory: one row per pricing tick, storing
      -- PnL % vs entry. Powers the dashboard "Profit x Time" chart. Pruned to a
      -- rolling window so it stays small.
      CREATE TABLE IF NOT EXISTS paper_price_samples (
        position_id INTEGER NOT NULL,
        at          INTEGER NOT NULL,
        pnl_pct     REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pps_pos ON paper_price_samples(position_id, at);
      CREATE INDEX IF NOT EXISTS idx_pps_at ON paper_price_samples(at);
    `,
  },
  {
    version: 10,
    up: /* sql */ `
      -- Project Athena: attention research results, durable across restarts +
      -- a "meme graveyard" of every researched coin (latest snapshot per mint).
      CREATE TABLE IF NOT EXISTS attention_research (
        mint           TEXT PRIMARY KEY,
        symbol         TEXT,
        name           TEXT,
        at             INTEGER NOT NULL,
        source         TEXT NOT NULL,
        attention      REAL NOT NULL,
        humanity       REAL NOT NULL,
        virality       REAL NOT NULL,
        outside_crypto REAL NOT NULL,
        cultural       REAL NOT NULL,
        confidence     REAL NOT NULL,
        narrative      TEXT,
        posts_count    INTEGER,
        platforms      TEXT,
        evidence_json  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_attn_at ON attention_research(at);
      CREATE INDEX IF NOT EXISTS idx_attn_score ON attention_research(attention);
    `,
  },
  {
    version: 11,
    up: /* sql */ `
      -- Data-truth (Phase 0/16): the coin's TRUE on-chain birth time (DexScreener
      -- pairCreatedAt, Unix ms). Lets the dashboard show real coin AGE instead of
      -- signal recency. NULL for pre-graduation coins with no DEX pair yet.
      ALTER TABLE signals ADD COLUMN pair_created_at INTEGER;
    `,
  },
  {
    version: 12,
    up: /* sql */ `
      -- Project Hermes: the Manus mission board. A mission is a structured
      -- investigation blueprint (MissionGenerator) composed for a shortlisted coin
      -- from evidence the engine already collected. The operator sends it to Manus
      -- (or a provider answers), then the recommendation is pasted back and flows
      -- through the SAME attention re-score path (decide() runs the safety gate
      -- FIRST). A mission carries NO authority of its own — it is advisory.
      CREATE TABLE IF NOT EXISTS missions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        mint         TEXT NOT NULL,
        symbol       TEXT,
        verdict      TEXT,
        conviction   REAL,
        status       TEXT NOT NULL DEFAULT 'open',
        mission_json TEXT NOT NULL,
        result_json  TEXT,
        provider     TEXT,
        created_at   INTEGER NOT NULL,
        resolved_at  INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_missions_mint ON missions(mint, created_at);
    `,
  },
  {
    version: 13,
    up: /* sql */ `
      -- Hermes automated Manus pipeline: external task refs + failure reason.
      ALTER TABLE missions ADD COLUMN external_id TEXT;
      ALTER TABLE missions ADD COLUMN external_url TEXT;
      ALTER TABLE missions ADD COLUMN sent_at INTEGER;
      ALTER TABLE missions ADD COLUMN error TEXT;

      -- V5.1 Phase 8 (audit finding: research history was last-writer-wins and lost).
      -- Append-only log of EVERY research result incl. provider provenance, so a
      -- Manus read can never be silently overwritten by a later Athena pass.
      CREATE TABLE IF NOT EXISTS attention_research_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        mint       TEXT NOT NULL,
        at         INTEGER NOT NULL,
        source     TEXT NOT NULL,
        attention  REAL NOT NULL,
        confidence REAL NOT NULL,
        narrative  TEXT,
        scores_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_attn_hist_mint ON attention_research_history(mint, at);
    `,
  },
  {
    version: 14,
    up: /* sql */ `
      -- Hermes Phase 3: mission kinds. 'research' = per-coin review (default);
      -- 'discovery' = Manus hunts candidates itself (mint='discovery' sentinel);
      -- 'deepdive' = batched hard-opinion review of multiple held/watched coins.
      ALTER TABLE missions ADD COLUMN kind TEXT NOT NULL DEFAULT 'research';
    `,
  },
  {
    version: 15,
    up: /* sql */ `
      -- P0 Measurement (IMPROVING_THE_AI.md): DURABLE realized-trades journal.
      -- Append-only, one row per CLOSED paper position, written at close time.
      -- /paper/reset must NEVER touch this table — it is the one PnL record that
      -- survives resets (a reset wiped 253 positions mid-audit; realized PnL was
      -- unverifiable across resets). UNIQUE(position_id) makes double-writes
      -- structurally impossible (the exit engine re-fires exits every tick).
      CREATE TABLE IF NOT EXISTS realized_trades (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id      INTEGER NOT NULL UNIQUE,
        mint             TEXT NOT NULL,
        symbol           TEXT,
        verdict          TEXT,
        flags            TEXT,
        opened_at        INTEGER NOT NULL,
        closed_at        INTEGER NOT NULL,
        hold_ms          INTEGER NOT NULL,
        entry_price_usd  REAL,
        exit_price_usd   REAL,
        peak_multiple    REAL,
        sol_invested     REAL NOT NULL,
        sol_returned     REAL NOT NULL,
        realized_pnl_sol REAL NOT NULL,
        realized_pnl_pct REAL,
        exit_reason      TEXT,
        dd_5m_pct        REAL,
        approx           INTEGER NOT NULL DEFAULT 0,
        created_at       INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_realized_closed ON realized_trades(closed_at);

      -- Reset audit log (also durable): when, what was wiped, where the export went.
      CREATE TABLE IF NOT EXISTS paper_resets (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        at                   INTEGER NOT NULL,
        export_path          TEXT,
        balance_sol          REAL,
        starting_balance_sol REAL,
        equity_sol           REAL,
        open_count           INTEGER,
        closed_count         INTEGER,
        fills_count          INTEGER
      );

      -- Fills now carry their position + the decision's provenance flags so the
      -- close-time journal write can aggregate EXACTLY this position's fills
      -- (mint alone is ambiguous across re-entries) and keep research:manus /
      -- src:scan provenance attached to the realized outcome (the Rule-7 A/B).
      ALTER TABLE paper_trades ADD COLUMN position_id INTEGER;
      ALTER TABLE paper_trades ADD COLUMN flags TEXT;
    `,
  },
  {
    version: 16,
    up: /* sql */ `
      -- SHADOW velocityExit experiment (operator, 2026-06-12): if an in-profit
      -- paper position gains ≥X pp within ≤90s, record the would-be sell price +
      -- timestamp — one row per (position, variant), NEVER changing a verdict.
      -- Variants X ∈ {8, 12, 15} run in parallel; compare realized PnL of each
      -- vs what actually happened after 3-5 days of accrual.
      CREATE TABLE IF NOT EXISTS shadow_velocity_exits (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id        INTEGER NOT NULL,
        variant_pct        REAL NOT NULL,
        mint               TEXT NOT NULL,
        symbol             TEXT,
        entry_at           INTEGER NOT NULL,
        triggered_at       INTEGER NOT NULL,
        trigger_price_usd  REAL NOT NULL,
        pnl_pct_at_trigger REAL NOT NULL,
        gain_window_pp     REAL NOT NULL,
        window_ms          INTEGER NOT NULL,
        UNIQUE(position_id, variant_pct)
      );
      CREATE INDEX IF NOT EXISTS idx_shadow_velocity_at ON shadow_velocity_exits(triggered_at);
      -- Tick-path validation needs history: index supports the 90s window lookups
      -- now that retention is extended 6h → 14d (exitEngine).
      CREATE INDEX IF NOT EXISTS idx_paper_samples_pos_at ON paper_price_samples(position_id, at);
    `,
  },
];

/** Run all pending migrations against the open database. Idempotent. */
export function runMigrations(db: Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    const tx = db.transaction(() => {
      db.exec(m.up);
      db.pragma(`user_version = ${m.version}`);
    });
    tx();
  }
}

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
