import WebSocket from "ws";
import { AgentBrowser } from "./agentBrowser.js";
import { log } from "../util/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// RESEARCH CAM — the operator's multi-pane CCTV view of the research browser.
// A dive now fans out across several agent-browser SESSIONS at once (Google, X,
// Reddit, Brave, DuckDuckGo, Bing — see researchAgent.RESEARCH_LANES). The cam
// attaches to EACH lane's runtime WebSocket stream (base64 JPEG frames),
// throttles per lane, and re-broadcasts every frame TAGGED with its lane so the
// dashboard shows all lanes searching simultaneously. Pure observation: it sends
// no input, it only renders what the read-only research browser is doing.
// ─────────────────────────────────────────────────────────────────────────────

export interface CamAction {
  at: number;
  lane: string;
  text: string;
}

interface LaneState {
  id: string;
  label: string;
  session: string;
  ab: AgentBrowser;
  ws?: WebSocket;
  status: "live" | "done";
  lastFrameAt: number;
  lastSentAt: number;
}

export interface CamPaneState {
  id: string;
  label: string;
  status: "live" | "done";
  lastFrameAt?: number;
}

export interface CamState {
  status: "idle" | "live";
  coinLabel?: string;
  lanes: CamPaneState[];
  actions: CamAction[];
}

const FRAME_MIN_GAP_MS = 650; // per-lane throttle (~1.5fps each)
const LANE_LINGER_MS = 8_000; // keep a finished lane's last frame up briefly

export class BrowserCam {
  private readonly lanes = new Map<string, LaneState>();
  private status: "idle" | "live" = "idle";
  private coinLabel?: string;
  private readonly actions: CamAction[] = [];

  constructor(private readonly hub: { broadcast: (type: string, data: unknown) => void }) {}

  /** Snapshot for first paint (GET /api/browsercam). */
  state(): CamState {
    return {
      status: this.status,
      coinLabel: this.coinLabel,
      lanes: [...this.lanes.values()].map((l) => ({
        id: l.id,
        label: l.label,
        status: l.status,
        lastFrameAt: l.lastFrameAt || undefined,
      })),
      actions: this.actions.slice(-18),
    };
  }

  /** A dive is starting — go LIVE (individual lanes attach via laneStart). */
  diveStart(coinLabel: string): void {
    this.coinLabel = coinLabel;
    this.status = "live";
    this.hub.broadcast("browsercam", { kind: "dive", status: "live", coinLabel });
  }

  /** One lane (its own session/stream) just went live — attach + show its pane. */
  async laneStart(laneId: string, label: string, session: string): Promise<void> {
    let lane = this.lanes.get(laneId);
    if (!lane) {
      lane = { id: laneId, label, session, ab: new AgentBrowser({ session }), status: "live", lastFrameAt: 0, lastSentAt: 0 };
      this.lanes.set(laneId, lane);
    }
    lane.label = label;
    lane.status = "live";
    this.hub.broadcast("browsercam", { kind: "lane", id: laneId, label, status: "live" });
    await this.connect(lane).catch((e) => log.warn(`research cam: lane ${laneId} stream failed: ${(e as Error).message}`));
  }

  /** Narrate one lane action (RESEARCH CAM ticker; laneId "all" = whole dive). */
  laneAction(laneId: string, text: string): void {
    const a: CamAction = { at: Date.now(), lane: laneId, text };
    this.actions.push(a);
    if (this.actions.length > 80) this.actions.shift();
    this.hub.broadcast("browsercam", { kind: "action", ...a });
  }

  /** A lane finished — mark done, drop its stream after a short linger. */
  laneEnd(laneId: string): void {
    const lane = this.lanes.get(laneId);
    if (!lane) return;
    lane.status = "done";
    this.hub.broadcast("browsercam", { kind: "lane", id: laneId, label: lane.label, status: "done" });
    setTimeout(() => this.disconnect(lane), LANE_LINGER_MS);
  }

  /** The whole dive finished — back to idle once lanes linger out. */
  diveEnd(): void {
    this.status = "idle";
    this.hub.broadcast("browsercam", { kind: "dive", status: "idle", coinLabel: this.coinLabel });
  }

  private async connect(lane: LaneState): Promise<void> {
    if (lane.ws && lane.ws.readyState === WebSocket.OPEN) return;
    const port = await lane.ab.streamPort();
    if (!port) {
      this.laneAction(lane.id, "⚠ stream unavailable");
      return;
    }
    this.disconnect(lane);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    lane.ws = ws;
    ws.on("message", (buf) => this.onFrame(lane, buf));
    ws.on("error", (e) => log.warn(`research cam ws (${lane.id}) error: ${e.message}`));
    ws.on("close", () => {
      if (lane.ws === ws) lane.ws = undefined;
    });
  }

  private disconnect(lane: LaneState): void {
    try {
      lane.ws?.close();
    } catch {
      /* ignore */
    }
    lane.ws = undefined;
  }

  private onFrame(lane: LaneState, buf: WebSocket.RawData): void {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(buf.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    const b64 = [m.data, m.frame, (m.payload as Record<string, unknown> | undefined)?.data].find(
      (v): v is string => typeof v === "string" && v.length > 1_000,
    );
    if (!b64) return;
    const now = Date.now();
    lane.lastFrameAt = now;
    if (now - lane.lastSentAt < FRAME_MIN_GAP_MS) return; // per-lane throttle
    lane.lastSentAt = now;
    this.hub.broadcast("browsercam", { kind: "frame", lane: lane.id, label: lane.label, jpeg: b64, at: now });
  }
}
