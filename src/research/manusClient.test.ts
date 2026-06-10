import { describe, it, expect, vi } from "vitest";
import { ManusClient, parseEvents, latestAgentStatus, extractStructuredResult, extractErrorMessage } from "./manusClient.js";

function fetchMock(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

describe("ManusClient.createTask", () => {
  it("POSTs the v2 contract with the x-manus-api-key header and returns task id/url", async () => {
    const f = fetchMock(200, { ok: true, task_id: "T1", task_url: "https://manus.im/t/T1" });
    const c = new ManusClient({ baseUrl: "https://api.manus.ai", apiKey: "K", fetchFn: f });
    const r = await c.createTask({ prompt: "research this", title: "m#1", agentProfile: "manus-1.6", schema: { type: "object" } });
    expect(r).toEqual({ taskId: "T1", taskUrl: "https://manus.im/t/T1" });
    const [url, init] = (f as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.manus.ai/v2/task.create");
    expect(init.headers["x-manus-api-key"]).toBe("K");
    const body = JSON.parse(init.body);
    expect(body.message.content).toBe("research this");
    expect(body.interactive_mode).toBe(false); // never pause to ask questions
    expect(body.structured_output_schema).toEqual({ type: "object" });
    expect(body.agent_profile).toBe("manus-1.6");
  });

  it("throws with status + body on an HTTP error (no silent fake success)", async () => {
    const c = new ManusClient({ baseUrl: "https://api.manus.ai", apiKey: "BAD", fetchFn: fetchMock(401, { error: "invalid key" }) });
    await expect(c.createTask({ prompt: "x" })).rejects.toThrow(/HTTP 401/);
  });

  it("throws when the response has no task_id", async () => {
    const c = new ManusClient({ baseUrl: "https://api.manus.ai", apiKey: "K", fetchFn: fetchMock(200, { ok: true }) });
    await expect(c.createTask({ prompt: "x" })).rejects.toThrow(/no task_id/);
  });
});

describe("tolerant event parsing", () => {
  it("parseEvents accepts events/messages/data envelopes and bare arrays", () => {
    expect(parseEvents({ events: [1] })).toEqual([1]);
    expect(parseEvents({ messages: [2] })).toEqual([2]);
    expect(parseEvents({ data: [3] })).toEqual([3]);
    expect(parseEvents([4])).toEqual([4]);
    expect(parseEvents("garbage")).toEqual([]);
  });

  it("latestAgentStatus finds agent_status at top level or nested", () => {
    expect(latestAgentStatus([{ type: "status_update", agent_status: "stopped" }])).toBe("stopped");
    expect(latestAgentStatus([{ type: "status_update", data: { agent_status: "running" } }])).toBe("running");
    expect(latestAgentStatus([{ type: "assistant_message" }, { agent_status: "error" }])).toBe("error");
    expect(latestAgentStatus([{ type: "assistant_message" }])).toBeUndefined();
    expect(latestAgentStatus([{ agent_status: "not-a-status" }])).toBeUndefined();
  });

  it("extractStructuredResult finds {success,value,error} in plausible shapes", () => {
    const value = { recommendation: "confirm", confidence: 80 };
    expect(extractStructuredResult([{ type: "structured_output_result", success: true, value }])).toEqual({ success: true, value, error: undefined });
    expect(extractStructuredResult([{ structured_output_result: { success: true, value } }])?.value).toEqual(value);
    expect(extractStructuredResult([{ structured_output: { success: true, value } }])?.value).toEqual(value);
    const failed = extractStructuredResult([{ type: "structured_output_result", success: false, error: "schema mismatch" }]);
    expect(failed?.success).toBe(false);
    expect(failed?.error).toBe("schema mismatch");
    expect(extractStructuredResult([{ type: "assistant_message" }])).toBeUndefined();
  });

  it("extractErrorMessage reads error_message events", () => {
    expect(extractErrorMessage([{ type: "error_message", content: "credits exhausted" }])).toBe("credits exhausted");
    expect(extractErrorMessage([{ type: "assistant_message", content: "hi" }])).toBeUndefined();
  });
});
