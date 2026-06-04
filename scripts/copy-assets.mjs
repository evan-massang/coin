// Copy static dashboard assets (html/css/js) into dist after tsc, since tsc
// only emits .js from .ts. Keeps `npm start` (prod) serving the real UI.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const src = "src/dashboard/public";
const dest = "dist/dashboard/public";

if (existsSync(src)) {
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`copied ${src} → ${dest}`);
} else {
  console.warn(`no assets at ${src}; skipping`);
}
