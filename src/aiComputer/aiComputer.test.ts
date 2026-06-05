import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkAction, isDomainAllowed, isForbiddenSelector } from "./actionPolicy.js";
import { requiresApproval, canEverApprove, ApprovalQueue } from "./humanApproval.js";
import { AuditLog } from "./auditLog.js";
import { pickNextDebate } from "./aiComputer.js";
import { openDb, type DB } from "../store/db.js";

describe("actionPolicy (the safety boundary)", () => {
  it("allows read-only navigate/screenshot on allowlisted domains", () => {
    expect(checkAction({ type: "navigate", url: "https://rugcheck.xyz/tokens/ABC" }).allowed).toBe(true);
    expect(checkAction({ type: "screenshot", url: "https://dexscreener.com/solana/ABC" }).allowed).toBe(true);
  });

  it("blocks non-allowlisted domains", () => {
    expect(checkAction({ type: "navigate", url: "https://evil.example.com" }).allowed).toBe(false);
    expect(isDomainAllowed("https://phishing.io")).toBe(false);
  });

  it("blocks ALL mutating actions (click/type/submit/cookies/download)", () => {
    for (const type of ["click", "type", "submit", "cookies", "download"] as const) {
      expect(checkAction({ type, url: "https://jup.ag/swap/SOL-ABC", selector: "#x" }).allowed).toBe(false);
    }
  });

  it("blocks wallet/financial/auth selectors", () => {
    expect(isForbiddenSelector("button.connect-wallet")).toBe(true);
    expect(isForbiddenSelector("#confirm-swap")).toBe(true);
    expect(isForbiddenSelector("input[name=password]")).toBe(true);
    expect(isForbiddenSelector(".chart")).toBe(false);
  });
});

describe("humanApproval", () => {
  it("read-only actions need no approval; mutating ones do", () => {
    expect(requiresApproval({ type: "navigate", url: "https://rugcheck.xyz/x" })).toBe(false);
    expect(requiresApproval({ type: "click", url: "https://jup.ag", selector: "#swap" })).toBe(true);
  });

  it("wallet/financial/mutating actions can NEVER be approved", () => {
    expect(canEverApprove({ type: "click", url: "https://jup.ag", selector: "button.connect-wallet" })).toBe(false);
    expect(canEverApprove({ type: "submit", url: "https://jup.ag" })).toBe(false);
    const q = new ApprovalQueue();
    q.request("t1", { type: "click", url: "https://jup.ag", selector: "#confirm-swap" });
    expect(q.approve("t1").ok).toBe(false);
  });
});

describe("pickNextDebate (always-on rotation)", () => {
  const COOL = 10 * 60_000;
  it("prefers the newest coin when nothing has been debated", () => {
    expect(pickNextDebate(["old", "mid", "new"], new Map(), 1_000_000, COOL)).toBe("new");
  });

  it("skips coins still within the cooldown and falls back to the next-newest", () => {
    const last = new Map([["new", 1_000_000]]); // just debated
    expect(pickNextDebate(["old", "mid", "new"], last, 1_000_000, COOL)).toBe("mid");
  });

  it("re-debates a coin once its cooldown has elapsed", () => {
    const last = new Map([["new", 0], ["mid", 0], ["old", 0]]);
    // now is past the cooldown for all ⇒ newest is eligible again
    expect(pickNextDebate(["old", "mid", "new"], last, COOL + 1, COOL)).toBe("new");
  });

  it("returns undefined when every coin is still cooling down", () => {
    const last = new Map([["a", 999_999], ["b", 1_000_000]]);
    expect(pickNextDebate(["a", "b"], last, 1_000_000, COOL)).toBeUndefined();
  });

  it("returns undefined when there are no live coins", () => {
    expect(pickNextDebate([], new Map(), 1, COOL)).toBeUndefined();
  });
});

describe("auditLog", () => {
  let db: DB;
  beforeEach(() => (db = openDb(":memory:")));
  afterEach(() => db.close());

  it("logs every action decision and lists them newest-first", () => {
    const audit = new AuditLog(db);
    audit.record({ at: 1, taskId: "t", actionType: "navigate", url: "https://rugcheck.xyz/x", allowed: true, reason: "ok" });
    audit.record({ at: 2, taskId: "t", actionType: "navigate", url: "https://evil.com", allowed: false, reason: "blocked" });
    const rows = audit.list();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.allowed).toBe(false); // newest first
    expect(rows[1]!.allowed).toBe(true);
  });
});
