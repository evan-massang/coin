import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Services } from "../services.js";
import { config } from "../config.js";
import { log } from "../util/logger.js";
import { coreRoutes } from "./routes.js";
import { settingsRoutes } from "./settingsRoutes.js";
import { paperRoutes } from "./routes.paper.js";
import { learningRoutes } from "./routes.learning.js";
import { aiComputerRoutes } from "./routes.aiComputer.js";
import { manusRoutes } from "./routes.manus.js";

function resolvePublicDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "public"), // dev (src/dashboard/public) or copied dist
    path.resolve(process.cwd(), "src/dashboard/public"), // prod fallback
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0]!;
}

export interface StartedServer {
  server: http.Server;
  url: string;
  close: () => Promise<void>;
}

export async function startServer(svc: Services): Promise<StartedServer> {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.use("/api", coreRoutes(svc));
  app.use("/api", settingsRoutes(svc));
  app.use("/api", paperRoutes(svc));
  app.use("/api", learningRoutes(svc));
  app.use("/api", aiComputerRoutes(svc));
  app.use("/api", manusRoutes(svc));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  const publicDir = resolvePublicDir();
  app.use(express.static(publicDir));
  // SPA fallback to index.html for any non-API GET.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  const server = http.createServer(app);
  svc.hub.attach(server);

  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  const url = `http://${config.host}:${config.port}`;
  log.ok(`dashboard listening at ${url}`);

  return {
    server,
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        svc.hub.close();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
