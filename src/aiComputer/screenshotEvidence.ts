import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

// Persists screenshot evidence under data/evidence/. Returns the saved path, or
// undefined if there's nothing to save.
const DIR = path.join(config.dataDir, "evidence");

export function saveScreenshot(taskId: string, label: string, buffer?: Buffer): string | undefined {
  if (!buffer || buffer.length === 0) return undefined;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const safe = `${taskId}-${label}`.replace(/[^a-z0-9-_]/gi, "_");
    const file = path.join(DIR, `${safe}.png`);
    fs.writeFileSync(file, buffer);
    return file;
  } catch {
    return undefined;
  }
}
