import { describe, it, expect, vi, afterEach } from "vitest";
import { opencodeReview } from "./opencodeCouncil.js";
import type { CouncilEvidence } from "./councilShared.js";

const ev: CouncilEvidence = {
  symbol: "X", bullCount: 1, bearCount: 0, bullPoints: [], bearPoints: [],
  clusterDetected: false, smartMoney: false, devSold: false, rugMatch: false,
};

afterEach(() => vi.restoreAllMocks());

function mockFetch(handler: (url: string) => unknown) {
  globalThis.fetch = vi.fn((url: string) => Promise.resolve(handler(url))) as unknown as typeof fetch;
}

describe("opencodeReview", () => {
  it("creates a session, sends evidence, parses the verdict", async () => {
    mockFetch((url) => {
      if (url.endsWith("/session")) return { ok: true, json: async () => ({ id: "ses_1" }) };
      if (url.includes("/message")) return { ok: true, json: async () => ({ info: {}, parts: [{ type: "text", text: '{"score":66,"recommendation":"confirm","rationale":"ok"}' }] }) };
      return { ok: false };
    });
    expect(await opencodeReview(ev, { baseUrl: "http://x", model: "openai/gpt-4o", role: "narrative_analyst" })).toEqual({
      score: 66, recommendation: "confirm", rationale: "ok",
    });
  });

  it("server unreachable ⇒ undefined (Claude-only fallback)", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch;
    expect(await opencodeReview(ev, { baseUrl: "http://x", model: "openai/gpt-4o", role: "risk_analyst" })).toBeUndefined();
  });

  it("model without provider/model ⇒ undefined, no network call", async () => {
    const f = vi.fn();
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await opencodeReview(ev, { baseUrl: "http://x", model: "gpt-4o", role: "bull_analyst" })).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
  });

  it("ignores non-text parts (tool/reasoning) and reads only text", async () => {
    mockFetch((url) => {
      if (url.endsWith("/session")) return { ok: true, json: async () => ({ id: "ses_1" }) };
      return { ok: true, json: async () => ({ parts: [{ type: "tool", foo: 1 }, { type: "text", text: '{"score":40,"recommendation":"caution","rationale":"risky"}' }] }) };
    });
    const v = await opencodeReview(ev, { baseUrl: "http://x", model: "deepseek/deepseek-chat", role: "contrarian" });
    expect(v?.score).toBe(40);
  });
});
