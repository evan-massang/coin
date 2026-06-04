import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { log } from "../util/logger.js";

/** Server-push hub. Live updates (new alerts, position changes) go out here. */
export class WsHub {
  private wss?: WebSocketServer;

  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "hello", data: { at: Date.now() } }));
    });
    log.info("websocket hub attached at /ws");
  }

  broadcast(type: string, data: unknown): void {
    if (!this.wss) return;
    const msg = JSON.stringify({ type, data });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  get clientCount(): number {
    return this.wss?.clients.size ?? 0;
  }

  close(): void {
    this.wss?.close();
  }
}
