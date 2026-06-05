import { runWithTimeout } from "../util/withTimeout.js";
import type { CouncilRole } from "../council/roles.js";
import { buildSystemPrompt, buildEvidencePrompt, parseVerdict, type CouncilEvidence, type CouncilVerdict } from "./councilShared.js";

// Direct Ollama transport for LOCAL council seats. OpenCode is a coding agent and
// always advertises tools, which tool-less local models (gemma/llama/qwen/phi via
// Ollama) reject with HTTP 400. So for `ollama/*` seats we talk to Ollama's
// OpenAI-compatible /v1/chat/completions endpoint directly — exactly what OpenCode
// would proxy to, minus the tools. Fully local, no keys, read-only (text only).
// Never throws → undefined on any failure (server down, model missing, bad output).

/** Raw chat completion against a local Ollama model. Never throws → undefined. */
export async function ollamaChat(
  baseUrl: string,
  model: string,
  system: string,
  user: string,
  timeoutMs = 90000,
): Promise<string | undefined> {
  const modelId = model.startsWith("ollama/") ? model.slice("ollama/".length) : model;
  const res = (await runWithTimeout(
    fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        stream: false,
        temperature: 0.3,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : undefined))
      .catch(() => undefined),
    timeoutMs,
    undefined,
  )) as { choices?: Array<{ message?: { content?: string } }> } | undefined;
  const content = res?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : undefined;
}

export async function ollamaReview(
  evidence: CouncilEvidence,
  opts: { baseUrl: string; model: string; role: CouncilRole; timeoutMs?: number },
): Promise<CouncilVerdict | undefined> {
  const text = await ollamaChat(
    opts.baseUrl,
    opts.model,
    buildSystemPrompt(opts.role),
    `Evidence:\n${buildEvidencePrompt(evidence)}\n\nReview as strict JSON from your seat.`,
    opts.timeoutMs ?? 90000,
  );
  return text ? parseVerdict(text) : undefined;
}
