import { runWithTimeout } from "../util/withTimeout.js";
import type { CouncilRole } from "../council/roles.js";
import { buildSystemPrompt, buildEvidencePrompt, parseVerdict, type CouncilEvidence, type CouncilVerdict } from "./councilShared.js";

// An OpenCode council seat. Reaches any model OpenCode is authed for, by talking
// to the LOCAL server: create a session, send the evidence with the seat's role
// system prompt and ALL tools disabled (read-only — it only returns text), then
// parse the JSON verdict. Never throws → undefined on any failure (server down,
// model not authed, timeout, bad output), so the council degrades gracefully.

// Disable every known OpenCode tool — the council must never act, only opine.
const DISABLED_TOOLS: Record<string, boolean> = {
  bash: false, edit: false, write: false, read: false, glob: false, grep: false,
  list: false, patch: false, webfetch: false, todowrite: false, todoread: false, task: false,
};

async function postJson(url: string, body: unknown, ms: number): Promise<unknown> {
  return runWithTimeout(
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : undefined))
      .catch(() => undefined),
    ms,
    undefined,
  );
}

export async function opencodeReview(
  evidence: CouncilEvidence,
  opts: { baseUrl: string; model: string; role: CouncilRole; timeoutMs?: number },
): Promise<CouncilVerdict | undefined> {
  const slash = opts.model.indexOf("/");
  if (slash <= 0) return undefined; // need "provider/model"
  const providerID = opts.model.slice(0, slash);
  const modelID = opts.model.slice(slash + 1);

  const session = (await postJson(`${opts.baseUrl}/session`, { title: "miro-council" }, 8000)) as { id?: string } | undefined;
  const sessionId = session?.id;
  if (!sessionId) return undefined;

  const msg = (await postJson(
    `${opts.baseUrl}/session/${sessionId}/message`,
    {
      model: { providerID, modelID },
      system: buildSystemPrompt(opts.role),
      tools: DISABLED_TOOLS,
      parts: [{ type: "text", text: `Evidence:\n${buildEvidencePrompt(evidence)}\n\nReview as strict JSON from your seat.` }],
    },
    opts.timeoutMs ?? 30000,
  )) as { parts?: Array<{ type?: string; text?: string }> } | undefined;

  if (!msg || !Array.isArray(msg.parts)) return undefined;
  const text = msg.parts.filter((p) => p?.type === "text" && typeof p.text === "string").map((p) => p.text).join("");
  return parseVerdict(text);
}
