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
