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
//
// STEALTH: a real Chrome User-Agent + dropping the blink AutomationControlled
// flag, applied via env to every launch. Probe 2026-06-12 (_probe_stealth.mjs)
// proved this alone clears the bot-challenges that vanilla CDP triggers — Brave
// 0→23, old.reddit 0→22, DuckDuckGo 0→10 results — so we did NOT need a Python
// anti-detection framework (SeleniumBase UC mode). These are launch flags: the
// daemon reads them when it first launches the browser for a session, so callers
// reset() the session once at boot to clear any pre-stealth daemon.
// ─────────────────────────────────────────────────────────────────────────────

const STEALTH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const STEALTH_ARGS = "--disable-blink-features=AutomationControlled,--disable-features=IsolateOrigins,site-per-process";

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

  /** Navigate. (TLS-inspection cert errors are bypassed via the env flag set in
   *  rawExec — NOT a per-command --ignore-https-errors, which the daemon rejects
   *  once it's already running: "ignored: daemon already running".) */
  async open(url: string): Promise<boolean> {
    const r = await this.exec(["open", url, "--json"], `open ${shortUrl(url)}`);
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

  /** Launch this session's daemon quietly (about:blank) so exactly ONE caller
   *  owns the launch — the cam then attaches its stream to the already-running
   *  daemon instead of racing it. No action note (keeps the ticker clean). */
  async warmup(): Promise<void> {
    await rawExec(["--session", this.session, "open", "about:blank", "--json"], this.timeoutMs);
  }

  /** Run an extraction script that returns JSON.stringify(...) — parsed here.
   *  agent-browser wraps the eval result inconsistently across versions/pages
   *  ({data}, {data:{result}}, {data:{value}}, or the bare value), and on a
   *  challenge/blank page may return a non-JSON string — so we unwrap defensively
   *  and the caller (evalArray) coerces. */
  async evalJson<T>(js: string, note?: string): Promise<T | undefined> {
    const r = await this.exec(["eval", js, "--json"], note);
    if (!r.ok) return undefined;
    let data: unknown;
    try {
      const envelope = JSON.parse(r.out) as { success?: boolean; data?: unknown; result?: unknown; value?: unknown };
      if (envelope.success === false) return undefined;
      data = envelope.data ?? envelope.result ?? envelope.value ?? envelope;
      // Unwrap one more level: { result } / { value } nested under data.
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const inner = data as { result?: unknown; value?: unknown };
        if (inner.result !== undefined) data = inner.result;
        else if (inner.value !== undefined) data = inner.value;
      }
    } catch {
      return undefined;
    }
    // The eval payload is itself a JSON.stringify(...) string → parse once more.
    if (typeof data === "string") {
      try {
        return JSON.parse(data) as T;
      } catch {
        return undefined; // a challenge page / plain-text response, not our JSON
      }
    }
    return data as T;
  }

  /** evalJson coerced to an array — the extraction boundary never yields a
   *  non-iterable (prevents the "rows is not iterable" collector crash). */
  async evalArray<T>(js: string, note?: string): Promise<T[]> {
    const v = await this.evalJson<unknown>(js, note);
    return Array.isArray(v) ? (v as T[]) : [];
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

  /** Force the next launch to pick up the stealth env (call once at boot — the
   *  daemon captures launch flags only when it first opens the browser). */
  async reset(): Promise<void> {
    await rawExec(["--session", this.session, "close"], 10_000);
  }

  /** Close EVERY session's browser (boot cleanup) so all research lanes relaunch
   *  fresh with the stealth env, regardless of leftover daemons from a prior run. */
  static async resetAll(): Promise<void> {
    await rawExec(["close", "--all"], 12_000);
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
      // never user input. windowsHide keeps the daemon spawn invisible. The
      // stealth env is read by the daemon when it launches the browser.
      {
        timeout: timeoutMs,
        shell: BIN.shell,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          AGENT_BROWSER_USER_AGENT: STEALTH_UA,
          AGENT_BROWSER_ARGS: STEALTH_ARGS,
          AGENT_BROWSER_IGNORE_HTTPS_ERRORS: "1",
          // Cap selector/wait timeouts so a missing element fails fast (15s) and
          // the lane proceeds to extract whatever DID load, instead of stalling 25s.
          AGENT_BROWSER_DEFAULT_TIMEOUT: "15000",
        },
      },
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
