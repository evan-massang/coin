import { getDb, type DB } from "./store/db.js";
import { SettingsStore } from "./store/settingsStore.js";
import { TokensRepo } from "./store/repositories/tokensRepo.js";
import { TradesRepo } from "./store/repositories/tradesRepo.js";
import { SignalsRepo } from "./store/repositories/signalsRepo.js";
import { PositionsRepo } from "./store/repositories/positionsRepo.js";
import { PaperRepo } from "./store/repositories/paperRepo.js";
import { LearningRepo } from "./store/repositories/learningRepo.js";
import { WalletsRepo } from "./store/repositories/walletsRepo.js";
import { CreatorHistoryRepo } from "./store/repositories/creatorHistoryRepo.js";
import { FingerprintRepo } from "./store/repositories/fingerprintRepo.js";
import { WalletClusterRepo } from "./store/repositories/walletClusterRepo.js";
import { CouncilRepo } from "./store/repositories/councilRepo.js";
import { MissionRepo } from "./store/repositories/missionRepo.js";
import { EventRecorder } from "./replay/eventRecorder.js";
import { AiComputer } from "./aiComputer/aiComputer.js";
import type { AttentionService } from "./attention/attentionService.js";
import { AttentionRepo } from "./store/repositories/attentionRepo.js";
import { WsHub } from "./dashboard/websocket.js";
import { RugcheckCache } from "./sources/rugcheckCache.js";
import { AlertDispatcher } from "./alerts/dispatcher.js";
import { DesktopNotifier } from "./alerts/desktopNotifier.js";
import { ChimePlayer } from "./alerts/sound.js";
import { config } from "./config.js";
import type { WalletStatus, GraphIntel } from "./types.js";

export interface EngineState {
  observing: number;
  decisionReady: number;
  highConviction: number;
  highRisk: number;
}

/** Mutable runtime state shared across engines + dashboard routes. */
export interface RuntimeState {
  wallet: WalletStatus;
  /** Latest per-token graph intelligence (recent tokens), for detail panels. */
  intel: Map<string, GraphIntel>;
  engineState: EngineState;
  /** Latest classified market regime (set by the /market route) — council context. */
  marketRegime?: string;
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
  creatorHistory: CreatorHistoryRepo;
  fingerprints: FingerprintRepo;
  walletCluster: WalletClusterRepo;
  council: CouncilRepo;
  /** Project Hermes mission board store (Manus missions + pasted recommendations). */
  missions: MissionRepo;
  events: EventRecorder;
  aiComputer: AiComputer;
  hub: WsHub;
  rugcheck: RugcheckCache;
  dispatcher: AlertDispatcher;
  runtime: RuntimeState;
  /** Attention Intelligence research service (Project Athena). Attached in index.ts
   *  so the engine container stays free of the optional browser/LLM dependencies. */
  attention?: AttentionService;
  /** Durable attention research store (Project Athena meme graveyard). */
  attentionRepo: AttentionRepo;
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
  const creatorHistory = new CreatorHistoryRepo(db);
  const fingerprints = new FingerprintRepo(db);
  const walletCluster = new WalletClusterRepo(db);
  const council = new CouncilRepo(db);
  const missions = new MissionRepo(db);
  const events = new EventRecorder(db);
  const attentionRepo = new AttentionRepo(db);
  const hub = new WsHub();
  const rugcheck = new RugcheckCache();
  // Runtime is built up-front so the AI council can read live graph intelligence
  // + market regime when forming opinions.
  const runtime: RuntimeState = {
    wallet: { address: settings.get("walletAddress"), connected: false },
    intel: new Map(),
    engineState: { observing: 0, decisionReady: 0, highConviction: 0, highRisk: 0 },
  };
  const aiComputer = new AiComputer(db, settings, tokens, runtime, council, (event) => hub.broadcast("council", event));

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
    creatorHistory,
    fingerprints,
    walletCluster,
    council,
    missions,
    events,
    attentionRepo,
    aiComputer,
    hub,
    rugcheck,
    dispatcher,
    runtime,
  };
}
