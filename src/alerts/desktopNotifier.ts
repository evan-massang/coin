import notifier from "node-notifier";
import { log } from "../util/logger.js";

export interface Notifier {
  notify(title: string, message: string): void;
}

/** OS desktop notification via node-notifier (best-effort; never throws). */
export class DesktopNotifier implements Notifier {
  notify(title: string, message: string): void {
    try {
      notifier.notify({ title, message, sound: false, wait: false });
    } catch (err) {
      log.warn(`desktop notify failed: ${(err as Error).message}`);
    }
  }
}

/** No-op notifier (tests / when notifications are disabled). */
export class NullNotifier implements Notifier {
  notify(): void {
    /* intentionally silent */
  }
}
