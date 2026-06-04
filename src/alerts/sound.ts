import fs from "node:fs";
import { log } from "../util/logger.js";

export interface SoundPlayer {
  play(): void;
}

/**
 * Audible alert cue. Tries to play an optional wav (data/alert.wav) via
 * sound-play; always also writes the terminal bell as a cheap cross-platform
 * fallback. Best-effort — never throws.
 */
export class ChimePlayer implements SoundPlayer {
  constructor(private readonly wavPath?: string) {}

  play(): void {
    process.stdout.write("\x07"); // terminal bell
    if (this.wavPath && fs.existsSync(this.wavPath)) {
      // Lazy import keeps startup fast and avoids a hard dep at load time.
      import("sound-play")
        .then((m) => (m.default ?? m).play(this.wavPath!))
        .catch((err) => log.debug(`sound play failed: ${(err as Error).message}`));
    }
  }
}

export class NullSound implements SoundPlayer {
  play(): void {
    /* silent */
  }
}
