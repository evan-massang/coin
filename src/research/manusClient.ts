// Thin HTTP client for the Manus API v2 (contract per open.manus.im docs):
//   POST {base}/v2/task.create      — header x-manus-api-key; body { message:{content},
//        agent_profile, interactive_mode, hide_in_task_list, title, structured_output_schema }
//        → { ok, task_id, task_url, ... }   (task runs ASYNC)
//   GET  {base}/v2/task.listMessages?task_id=&order=desc&limit=  — poll events;
//        status_update events carry agent_status: running|stopped|waiting|error;
//        when stopped, a structured_output_result event carries { success, value, error }.
// The exact event envelope is not fully documented, so the parsers below are
// deliberately TOLERANT (multiple plausible shapes) and pure/unit-tested; the
// runner logs the raw body whenever parsing misses, so a contract drift is
// visible in the audit trail instead of silently swallowed.

export type ManusAgentStatus = "running" | "stopped" | "waiting" | "error";

export interface ManusCreated {
  taskId: string;
  taskUrl?: string;
}

export interface ManusStructuredResult {
  success: boolean;
  value?: unknown;
  error?: string;
}

export interface ManusClientOpts {
  baseUrl: string;
  apiKey: string;
  /** Injectable for tests. */
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class ManusClient {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: ManusClientOpts) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  private async call(path: string, init: RequestInit): Promise<unknown> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.opts.baseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", "x-manus-api-key": this.opts.apiKey, ...(init.headers ?? {}) },
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`manus ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`manus ${path} returned non-JSON: ${text.slice(0, 200)}`);
      }
    } finally {
      clearTimeout(t);
    }
  }

  /** Create an async research task. */
  async createTask(p: { prompt: string; title?: string; agentProfile?: string; schema?: object }): Promise<ManusCreated> {
    const body = {
      message: { content: p.prompt },
      agent_profile: p.agentProfile ?? "manus-1.6",
      interactive_mode: false, // never pause to ask the engine questions
      hide_in_task_list: false, // operator can watch the task live in the Manus app
      ...(p.title ? { title: p.title } : {}),
      ...(p.schema ? { structured_output_schema: p.schema } : {}),
    };
    const r = (await this.call("/v2/task.create", { method: "POST", body: JSON.stringify(body) })) as Record<string, unknown>;
    const taskId = str(r.task_id) ?? str(r.taskId);
    if (!taskId) throw new Error(`manus task.create: no task_id in response ${JSON.stringify(r).slice(0, 200)}`);
    return { taskId, taskUrl: str(r.task_url) ?? str(r.taskUrl) };
  }

  /** Raw event list for a task (newest first). */
  async listMessages(taskId: string, limit = 30): Promise<unknown[]> {
    const r = await this.call(`/v2/task.listMessages?task_id=${encodeURIComponent(taskId)}&order=desc&limit=${limit}`, { method: "GET" });
    return parseEvents(r);
  }
}

// ── pure, tolerant parsers (unit-tested) ────────────────────────────────────

/** Accept { events: [...] } / { messages: [...] } / { data: [...] } / bare array. */
export function parseEvents(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    for (const k of ["events", "messages", "data", "items"]) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
  }
  return [];
}

const STATUSES: ManusAgentStatus[] = ["running", "stopped", "waiting", "error"];

function statusOf(ev: unknown): ManusAgentStatus | undefined {
  if (!ev || typeof ev !== "object") return undefined;
  const o = ev as Record<string, unknown>;
  for (const v of [o.agent_status, (o.data as Record<string, unknown> | undefined)?.agent_status, (o.status_update as Record<string, unknown> | undefined)?.agent_status]) {
    if (typeof v === "string" && STATUSES.includes(v as ManusAgentStatus)) return v as ManusAgentStatus;
  }
  return undefined;
}

/** Latest agent_status in an events list (assumes newest-first as we request order=desc). */
export function latestAgentStatus(events: unknown[]): ManusAgentStatus | undefined {
  for (const ev of events) {
    const s = statusOf(ev);
    if (s) return s;
  }
  return undefined;
}

/** Find the structured-output result event: { success, value, error }. */
export function extractStructuredResult(events: unknown[]): ManusStructuredResult | undefined {
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const o = ev as Record<string, unknown>;
    const isResult =
      o.type === "structured_output_result" ||
      o.event === "structured_output_result" ||
      o.structured_output !== undefined ||
      o.structured_output_result !== undefined;
    if (!isResult) continue;
    const payload = (o.structured_output_result ?? o.structured_output ?? o.result ?? o) as Record<string, unknown>;
    const value = payload.value ?? (payload.success === undefined && o.type === "structured_output_result" ? payload : undefined);
    return {
      success: payload.success !== false && value !== undefined,
      value,
      error: typeof payload.error === "string" ? payload.error : undefined,
    };
  }
  return undefined;
}

/** Best-effort error text from an events list. */
export function extractErrorMessage(events: unknown[]): string | undefined {
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const o = ev as Record<string, unknown>;
    if (o.type === "error_message" || o.event === "error_message") {
      const c = o.content ?? o.message ?? o.text ?? (o.data as Record<string, unknown> | undefined)?.content;
      if (typeof c === "string") return c.slice(0, 400);
    }
  }
  return undefined;
}

function str(x: unknown): string | undefined {
  return typeof x === "string" && x ? x : undefined;
}
