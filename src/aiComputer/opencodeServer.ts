import { spawn, type ChildProcess } from "node:child_process";
import { runWithTimeout } from "../util/withTimeout.js";
import { log } from "../util/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// OpenCode connection layer. The council reaches 75+ models through a LOCAL
// OpenCode server (provider credentials live inside OpenCode, never here). This
// manager just makes sure a server is reachable: it probes /global/health and —
// only if autoServe is on — spawns `opencode serve` once. Every failure mode
// (not installed, won't start, unreachable) degrades to "no OpenCode" so the
// council falls back to Claude-only and the scanner never stops.
// ─────────────────────────────────────────────────────────────────────────────

export interface OpencodeConfig {
  enabled: boolean;
  autoServe: boolean;
  port: number;
  bin: string;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class OpencodeServer {
  private child?: ChildProcess;
  private startPromise?: Promise<string | undefined>;
  private spawnFailed = false;

  baseUrl(port: number): string {
    return `http://127.0.0.1:${port}`;
  }

  /** Returns a reachable base URL, or undefined (⇒ council runs Claude-only). */
  async ensure(cfg: OpencodeConfig): Promise<string | undefined> {
    if (!cfg.enabled) return undefined;
    const url = this.baseUrl(cfg.port);
    if (await this.healthy(url)) return url; // already running (ours or the user's)
    if (!cfg.autoServe || this.spawnFailed) return undefined;
    if (!this.startPromise) this.startPromise = this.spawnAndWait(cfg, url);
    return this.startPromise;
  }

  private async spawnAndWait(cfg: OpencodeConfig, url: string): Promise<string | undefined> {
    try {
      log.info(`opencode: spawning \`${cfg.bin} serve --port ${cfg.port}\``);
      this.child = spawn(cfg.bin, ["serve", "--port", String(cfg.port), "--hostname", "127.0.0.1"], {
        shell: process.platform === "win32", // resolve the npm .cmd shim on Windows
        stdio: "ignore",
        windowsHide: true,
      });
      this.child.on("error", (e) => {
        this.spawnFailed = true;
        log.warn(`opencode: could not start (${(e as Error).message}). Install it: npm i -g opencode-ai`);
      });
      this.child.on("exit", () => { this.child = undefined; });
      for (let i = 0; i < 30; i++) { // ~15s budget
        if (this.spawnFailed) break;
        if (await this.healthy(url)) { log.ok("opencode: server ready"); return url; }
        await delay(500);
      }
      log.warn("opencode: server did not become healthy — council stays Claude-only");
      return undefined;
    } catch (e) {
      this.spawnFailed = true;
      log.warn(`opencode: spawn failed (${(e as Error).message})`);
      return undefined;
    }
  }

  private async healthy(url: string): Promise<boolean> {
    const r = await runWithTimeout(
      fetch(`${url}/global/health`).then((res) => res.ok).catch(() => false),
      1500,
      false,
    );
    return r;
  }

  stop(): void {
    if (this.child) {
      try { this.child.kill(); } catch { /* already gone */ }
      this.child = undefined;
    }
    this.startPromise = undefined;
  }
}
