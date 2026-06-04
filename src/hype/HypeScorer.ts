import fs from "node:fs";
import type { HypeResult } from "../types.js";
import type { SettingsStore } from "../store/settingsStore.js";
import { config } from "../config.js";
import { log } from "../util/logger.js";
import { computeHeuristicHype, type HypeToken, type NarrativeBucket } from "./heuristicScorer.js";
import { scoreWithLlm } from "./llmScorer.js";
import { HypeCache } from "./cache.js";

// Orchestrates the hype layer (§1.7): heuristic always available (free); Claude
// used only when the user supplied a key, cached per-mint, and degrading to the
// heuristic on any error. AI is confirmation only — it can never override safety
// or be the sole BUY trigger (its conviction weight is small).
export class HypeScorer {
  private readonly cache = new HypeCache();
  private narratives?: NarrativeBucket[];
  private knownMemes?: string[];

  constructor(private readonly settings: SettingsStore) {}

  private loadData(): void {
    if (this.narratives && this.knownMemes) return;
    this.narratives = readJson<{ narratives: NarrativeBucket[] }>(config.narrativesPath)?.narratives ?? [];
    this.knownMemes = readJson<{ memes: string[] }>(config.knownMemesPath)?.memes ?? [];
  }

  async score(token: HypeToken & { mint: string }): Promise<HypeResult> {
    const cached = this.cache.get(token.mint);
    if (cached) return cached;
    this.loadData();

    const heuristic = computeHeuristicHype(token, this.narratives!, this.knownMemes!);
    let result = heuristic;

    const key = this.settings.get("anthropicApiKey");
    if (key) {
      try {
        const llm = await scoreWithLlm(token, key);
        // Keep the heuristic's revival flag if the LLM missed it (keyword match is reliable).
        result = { ...llm, isRevival: llm.isRevival || heuristic.isRevival };
      } catch (err) {
        log.debug(`hype LLM failed, using heuristic: ${(err as Error).message}`);
      }
    }

    this.cache.set(token.mint, result);
    return result;
  }
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}
