import type { Alert, Decision } from "../types.js";
import { LOUD_VERDICTS } from "../types.js";
import type { SettingsStore } from "../store/settingsStore.js";
import type { Notifier } from "./desktopNotifier.js";
import type { SoundPlayer } from "./sound.js";
import { decisionToAlert, notificationText } from "./templates.js";
import { log } from "../util/logger.js";

export interface DispatcherDeps {
  settings: SettingsStore;
  notifier: Notifier;
  sound: SoundPlayer;
  /** Persist to the journal (signalsRepo.insert). Returns the new signal id. */
  journal?: (decision: Decision, priceAtAlert?: number) => number | void;
  /** Push the alert to connected dashboard clients (websocket). */
  broadcast?: (alert: Alert) => void;
}

export interface DispatchOptions {
  priceAtAlert?: number;
  /** Skip journalling (e.g. re-dispatch of an already-journalled exit). */
  skipJournal?: boolean;
}

/**
 * Central alert sink. EVERY decision is journalled + pushed to the UI. Only
 * "loud" verdicts (BUY_x / SELL_x) fire a desktop notification + sound, and the
 * BUY verdicts additionally must clear the user's min-conviction. AVOID,
 * WATCH_ONLY and TOO_LATE are shown in the UI but stay quiet — the do-not-alert
 * zones (§1.5).
 */
export class AlertDispatcher {
  constructor(private readonly deps: DispatcherDeps) {}

  dispatch(decision: Decision, opts: DispatchOptions = {}): Alert {
    const alert = decisionToAlert(decision);

    if (!opts.skipJournal && this.deps.journal) {
      try {
        this.deps.journal(decision, opts.priceAtAlert);
      } catch (err) {
        log.warn(`journal write failed: ${(err as Error).message}`);
      }
    }

    this.deps.broadcast?.(alert);

    if (this.shouldNotify(alert)) {
      const s = this.deps.settings.all();
      const { title, message } = notificationText(alert);
      if (s.desktopNotifications) this.deps.notifier.notify(title, message);
      if (s.sound) this.deps.sound.play();
    }

    return alert;
  }

  /** Loud-verdict gating (§1.5). */
  shouldNotify(alert: Alert): boolean {
    if (!LOUD_VERDICTS.has(alert.kind)) return false;
    const s = this.deps.settings.all();
    // Exit alerts always notify (exits matter); BUY_* must clear min conviction.
    const isExit = alert.kind === "SELL_TRIM" || alert.kind === "SELL_EXIT_NOW";
    if (isExit) return true;
    return alert.conviction >= s.minConviction;
  }
}
