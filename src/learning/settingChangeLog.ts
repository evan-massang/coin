import type { Services } from "../services.js";
import type { SettingChange } from "../types.js";

// Reader over the setting-change audit log (writes happen in SettingsStore, which
// logs every manual apply + bounded auto-tune). Surfaces history to the UI and
// enforces the per-day auto-tune count rail.
export class SettingChangeLog {
  constructor(private readonly svc: Services) {}

  recent(limit = 100): SettingChange[] {
    return this.svc.learning.changeLog(limit);
  }

  autoChangesToday(now = Date.now()): number {
    const startOfDay = now - (now % 86_400_000);
    return this.svc.learning.autoChangesSince(startOfDay);
  }
}
