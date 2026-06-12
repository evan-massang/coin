import WebSocket from "ws";
import type { AgentBrowser } from "./agentBrowser.js";
import { log } from "../util/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// RESEARCH CAM — the operator's CCTV view of the research browser. Connects to
// agent-browser's runtime WebSocket stream (base64 JPEG viewport frames),
// throttles to ≤2fps, and re-broadcasts on the dashboard hub together with the
// action ticker ("open bing…", "wait for results", …). Pure observation: it
// renders what the read-only research browser is doing; it sends NO input.
// ─────────────────────────────────────────────────────────────────────────────

export interface CamAction {
  at: number;
  text: string;
}

export interface CamState {
  status: "idle" | "live";
  label?: string; // what we're researching (e.g. "$WIF dogwifhat")
  actions: CamAction[];
  lastFrameAt?: number;
}

const FRAME_MIN_GAP_MS = 600; // ≤ ~1.7fps to the dashboard
const IDLE_DISCONNECT_MS = 30_000;

export class BrowserCam {
  private ws?: WebSocket;
  private status: "idle" | "live" = "idle";
  private label?: string;
  private readonly actions: CamAction[] = [];
  private lastFrameAt = 0;
  private lastFrameSentAt = 0;
  private idleTimer?: NodeJS.Timeout;

  constructor(
    private readonly hub: { broadcast: (type: string, data: unknown) => void },
    private readonly ab: AgentBrowser,
  ) {}

  /** Current state for first paint (GET /api/browsercam). */
  state(): CamState {
    return {
      status: this.status,
      label: this.label,
      actions: this.actions.slice(-14),
      lastFrameAt: this.lastFrameAt || undefined,
    };
  }

  /** Narrate one browser action (also called by the AgentBrowser onAction hook). */
  note(text: string): void {
    const a = { at: Date.now(), text };
    this.actions.push(a);
    if (this.actions.length > 60) this.actions.shift();
    this.hub.broadcast("browsercam", { kind: "action", ...a });
  }

  /** A research dive is starting — go LIVE and attach to the frame stream. */
  async diveStart(label: string): Promise<void> {
    this.label = label;
    this.status = "live";
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.hub.broadcast("browsercam", { kind: "status", status: "live", label });
    await this.connect().catch((e) => log.warn(`research cam: stream connect failed: ${(e as Error).message}`));
  }

  /** Dive finished — back to NO SIGNAL after a short linger. */
  diveEnd(): void {
    this.status = "idle";
    this.hub.broadcast("browsercam", { kind: "status", status: "idle", label: this.label });
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.disconnect(), IDLE_DISCONNECT_MS);
  }

  private async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    const port = await this.ab.streamPort();
    if (!port) {
      this.note("⚠ stream unavailable (agent-browser not running?)");
      return;
    }
    this.disconnect();
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws = ws;
    ws.on("message", (buf) => this.onMessage(buf));
    ws.on("error", (e) => log.warn(`research cam ws error: ${e.message}`));
    ws.on("close", () => {
      if (this.ws === ws) this.ws = undefined;
    });
  }

  private disconnect(): void {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = undefined;
  }

  private onMessage(buf: WebSocket.RawData): void {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(buf.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    // Frame messages carry a large base64 JPEG payload (field name varies by
    // version — duck-type on "long base64 string").
    const b64 = [m.data, m.frame, (m.payload as Record<string, unknown> | undefined)?.data].find(
      (v): v is string => typeof v === "string" && v.length > 1_000,
    );
    if (!b64) return;
    const now = Date.now();
    this.lastFrameAt = now;
    if (now - this.lastFrameSentAt < FRAME_MIN_GAP_MS) return; // throttle
    this.lastFrameSentAt = now;
    this.hub.broadcast("browsercam", { kind: "frame", jpeg: b64, at: now });
  }
}
