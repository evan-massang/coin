import { runWithTimeout } from "../util/withTimeout.js";
import type { CouncilRole } from "../council/roles.js";
import { buildSystemPrompt, buildEvidencePrompt, parseVerdict, type CouncilEvidence, type CouncilVerdict } from "./councilShared.js";

// Direct Ollama transport for LOCAL council seats. OpenCode is a coding agent and
// always advertises tools, which tool-less local models (gemma/llama/qwen/phi via
// Ollama) reject with HTTP 400. So for `ollama/*` seats we talk to Ollama's
// OpenAI-compatible /v1/chat/completions endpoint directly — exactly what OpenCode
// would proxy to, minus the tools. Fully local, no keys, read-only (text only).
// Never throws → undefined on any failure (server down, model missing, bad output).

export async function ollamaReview(
  evidence: CouncilEvidence,
  opts: { baseUrl: string; model: string; role: CouncilRole; timeoutMs?: number },
): Promise<CouncilVerdict | undefined> {
  const model = opts.model.startsWith("ollama/") ? opts.model.slice("ollama/".length) : opts.model;
  const body = {
    model,
    stream: false,
    temperature: 0.3,
    messages: [
      { role: "system", content: buildSystemPrompt(opts.role) },
      { role: "user", content: `Evidence:\n${buildEvidencePrompt(evidence)}\n\nReview as strict JSON from your seat.` },
    ],
  };
  const res = (await runWithTimeout(
    fetch(`${opts.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : undefined))
      .catch(() => undefined),
    opts.timeoutMs ?? 90000,
    undefined,
  )) as { choices?: Array<{ message?: { content?: string } }> } | undefined;
  const content = res?.choices?.[0]?.message?.content;
  return typeof content === "string" ? parseVerdict(content) : undefined;
}
