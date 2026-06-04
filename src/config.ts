import "dotenv/config";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap config ONLY. Everything the user tunes (wallet address, API keys,
// risk thresholds, paper trading, learning mode) lives in SQLite and is edited
// from the dashboard Settings tab — see store/settingsStore.ts.
//
// There is intentionally NO private key and NO auto-buy here. This engine never
// signs or sends a transaction.
// ─────────────────────────────────────────────────────────────────────────────

function str(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : fallback;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

const dataDir = path.resolve(str("DATA_DIR", "data"));

export const config = {
  /** Dashboard bind — localhost only by default. */
  host: str("HOST", "127.0.0.1"),
  port: num("PORT", 3000),

  /** Default Solana RPC. A Helius key in Settings takes precedence at runtime. */
  rpcUrl: str("RPC_URL", "https://api.mainnet-beta.solana.com"),
  pumpportalWs: str("PUMPPORTAL_WS", "wss://pumpportal.fun/api/data"),

  /** Local data directory + SQLite path. */
  dataDir,
  dbPath: path.join(dataDir, "sniper.sqlite"),
  narrativesPath: path.join(dataDir, "narratives.json"),
  knownMemesPath: path.join(dataDir, "known-memes.json"),
} as const;

export type AppConfig = typeof config;
