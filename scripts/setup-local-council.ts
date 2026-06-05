/**
 * One-shot: point the engine's AI council at 5 LOCAL models served by OpenCode
 * via Ollama, and turn the OpenCode council on. Run BEFORE starting the engine
 * (settings are cached in-process): `tsx scripts/setup-local-council.ts`.
 * Re-run any time to reset the roster. Local-only, no API keys, advisory council.
 */
import { createServices } from "../src/services.js";

const svc = createServices();
svc.settings.update(
  {
    opencodeEnabled: true,
    opencodeAutoServe: true, // engine spawns `opencode serve` itself
    opencodePort: 4096,
    councilMembers: [
      { id: "qwen", label: "Qwen 3B", role: "bull_analyst", provider: "opencode", model: "ollama/qwen2.5:3b", enabled: true },
      { id: "llama", label: "Llama 3.2", role: "narrative_analyst", provider: "opencode", model: "ollama/llama3.2:3b", enabled: true },
      { id: "gemma", label: "Gemma 2", role: "risk_analyst", provider: "opencode", model: "ollama/gemma2:2b", enabled: true },
      { id: "phi", label: "Phi 3.5", role: "contrarian", provider: "opencode", model: "ollama/phi3.5", enabled: true },
      { id: "deepseek", label: "DeepSeek R1", role: "lead_reviewer", provider: "opencode", model: "ollama/deepseek-r1:1.5b", enabled: true },
    ],
  },
  "user",
  "local council setup",
);

const m = svc.settings.get("councilMembers");
// eslint-disable-next-line no-console
console.log(`local council configured: ${m.length} seats →`, m.map((x) => `${x.label}(${x.role})=${x.model}`).join(", "));
