import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log } from "../util/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// agent-browser CLI wrapper (vercel-labs/agent-browser) — the engine's research
// browser driver. Rust daemon + CDP; ~1s headless launch (doctor-verified on
// this machine); WebSocket frame streaming powers the dashboard RESEARCH CAM.
//
// READ-ONLY BY CONSTRUCTION: this wrapper exposes ONLY navigate / wait / eval /
// get / stream / close. No click, no fill, no auth, no cookies, no upload —
// the engine reads public pages, it never acts on them. Eval is used solely
// for DOM extraction (the scripts live in researchAgent.ts).
// ─────────────────────────────────────────────────────────────────────────────

export interface AbExec {
  ok: boolean;
  out: string;
}

/** Resolve the native binary (npm global install ships per-platform binaries).
 *  Falls back to the PATH shim through a shell when not found. */
function resolveBin(): { file: string; shell: boolean } {
  const env = process.env.AGENT_BROWSER_BIN;
  if (env && fs.existsSync(env)) return { file: env, shell: false };
  if (process.platform === "win32" && process.env.APPDATA) {
    const exe = path.join(process.env.APPDATA, "npm", "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
    if (fs.existsSync(exe)) return { file: exe, shell: false };
  }
  return { file: "agent-browser", shell: true };
}

let cachedAvailable: boolean | undefined;
const BIN = resolveBin();

export class AgentBrowser {
  private readonly session: string;
  private readonly timeoutMs: number;
  /** Action narrator — every command is reported here (RESEARCH CAM ticker). */
  onAction?: (text: string) => void;

  constructor(opts: { session?: string; timeoutMs?: number; onAction?: (text: string) => void } = {}) {
    this.session = opts.session ?? "mirofish";
    this.timeoutMs = opts.timeoutMs ?? 35_000;
    this.onAction = opts.onAction;
  }

  /** Is the CLI installed? Cached process-wide. */
  static async available(): Promise<boolean> {
    if (cachedAvailable !== undefined) return cachedAvailable;
    const r = await rawExec(["--version"], 10_000);
    cachedAvailable = r.ok;
    return cachedAvailable;
  }

  private async exec(args: string[], note?: string): Promise<AbExec> {
    if (note) this.onAction?.(note);
    return rawExec(["--session", this.session, ...args], this.timeoutMs);
  }

  /** Navigate (ignoring this machine's TLS-inspection cert errors — read-only). */
  async open(url: string): Promise<boolean> {
    const r = await this.exec(["--ignore-https-errors", "open", url, "--json"], `open ${shortUrl(url)}`);
    if (!r.ok) return false;
    try {
      return JSON.parse(r.out).success === true;
    } catch {
      return false;
    }
  }

  /** Wait for a CSS selector (best-effort; false on timeout). */
  async waitFor(selector: string): Promise<boolean> {
    const r = await this.exec(["wait", selector], `wait for ${selector}`);
    return r.ok && !/timed out/i.test(r.out);
  }

  async waitMs(ms: number): Promise<void> {
    await this.exec(["wait", String(ms)]);
  }

  /** Run an extraction script that returns JSON.stringify(...) — parsed here. */
  async evalJson<T>(js: string, note?: string): Promise<T | undefined> {
    const r = await this.exec(["eval", js, "--json"], note);
    if (!r.ok) return undefined;
    try {
      const envelope = JSON.parse(r.out) as { success?: boolean; data?: unknown };
      if (envelope.success !== true) return undefined;
      const data = envelope.data;
      if (typeof data === "string") return JSON.parse(data) as T;
      return data as T;
    } catch {
      return undefined;
    }
  }

  async currentUrl(): Promise<string> {
    const r = await this.exec(["get", "url"]);
    return r.ok ? r.out.trim() : "";
  }

  /** Ensure WebSocket streaming is on; returns the bound port (RESEARCH CAM). */
  async streamPort(): Promise<number | undefined> {
    await this.exec(["stream", "enable", "--json"]); // tolerates already-enabled
    const r = await this.exec(["stream", "status", "--json"]);
    if (!r.ok) return undefined;
    try {
      const j = JSON.parse(r.out) as { data?: { port?: number } };
      return j.data?.port;
    } catch {
      return undefined;
    }
  }

  async close(): Promise<void> {
    await this.exec(["close"], "close session");
  }
}

function shortUrl(u: string): string {
  return u.length > 80 ? u.slice(0, 77) + "…" : u;
}

function rawExec(args: string[], timeoutMs: number): Promise<AbExec> {
  return new Promise((resolve) => {
    execFile(
      BIN.file,
      args,
      // shell only for the PATH-shim fallback (npm .cmd); args are engine-built,
      // never user input. windowsHide keeps the daemon spawn invisible.
      { timeout: timeoutMs, shell: BIN.shell, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          log.warn(`agent-browser ${args.slice(0, 3).join(" ")} failed: ${String(stderr || err.message).slice(0, 160)}`);
          resolve({ ok: false, out: String(stdout || "") });
        } else {
          resolve({ ok: true, out: String(stdout || "") });
        }
      },
    );
  });
}
