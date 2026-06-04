import { getDb, type DB } from "./store/db.js";
import { SettingsStore } from "./store/settingsStore.js";
import { TokensRepo } from "./store/repositories/tokensRepo.js";
import { TradesRepo } from "./store/repositories/tradesRepo.js";
import { SignalsRepo } from "./store/repositories/signalsRepo.js";
import { PositionsRepo } from "./store/repositories/positionsRepo.js";
import { PaperRepo } from "./store/repositories/paperRepo.js";
import { LearningRepo } from "./store/repositories/learningRepo.js";
import { WalletsRepo } from "./store/repositories/walletsRepo.js";
import { WsHub } from "./dashboard/websocket.js";
import { RugcheckCache } from "./sources/rugcheckCache.js";
import { AlertDispatcher } from "./alerts/dispatcher.js";
import { DesktopNotifier } from "./alerts/desktopNotifier.js";
import { ChimePlayer } from "./alerts/sound.js";
import { config } from "./config.js";
import type { WalletStatus } from "./types.js";

/** Mutable runtime state shared across engines + dashboard routes. */
export interface RuntimeState {
  wallet: WalletStatus;
}

/**
 * The wired application: one DB, one settings store, all repos, the websocket
 * hub, and the alert dispatcher (journals + broadcasts + notifies). Engines
 * (scanner, observer, exit, paper, learning) are attached in later phases and
 * all read from this container.
 */
export interface Services {
  db: DB;
  settings: SettingsStore;
  tokens: TokensRepo;
  trades: TradesRepo;
  signals: SignalsRepo;
  positions: PositionsRepo;
  paperPositions: PositionsRepo;
  paper: PaperRepo;
  learning: LearningRepo;
  wallets: WalletsRepo;
  hub: WsHub;
  rugcheck: RugcheckCache;
  dispatcher: AlertDispatcher;
  runtime: RuntimeState;
}

export function createServices(db: DB = getDb()): Services {
  const settings = new SettingsStore(db);
  const tokens = new TokensRepo(db);
  const trades = new TradesRepo(db);
  const signals = new SignalsRepo(db);
  const positions = new PositionsRepo(db, "positions");
  const paperPositions = new PositionsRepo(db, "paper_positions");
  const paper = new PaperRepo(db);
  const learning = new LearningRepo(db);
  const wallets = new WalletsRepo(db);
  const hub = new WsHub();
  const rugcheck = new RugcheckCache();

  const dispatcher = new AlertDispatcher({
    settings,
    notifier: new DesktopNotifier(),
    sound: new ChimePlayer(config.dataDir + "/alert.wav"),
    journal: (decision, priceAtAlert) => signals.insert(decision, priceAtAlert),
    broadcast: (alert) => hub.broadcast("alert", alert),
  });

  return {
    db,
    settings,
    tokens,
    trades,
    signals,
    positions,
    paperPositions,
    paper,
    learning,
    wallets,
    hub,
    rugcheck,
    dispatcher,
    runtime: {
      wallet: { address: settings.get("walletAddress"), connected: false },
    },
  };
}
