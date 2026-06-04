import { checkAction, isForbiddenSelector, type ActionRequest } from "./actionPolicy.js";

// Human-in-the-loop gate. Any action the policy forbids is "consequential" and
// would need explicit approval to ever run — EXCEPT wallet/financial/auth
// actions, which can NEVER be approved (there is no code path that signs or
// spends, by design). No consequential actions are enabled by default.

export function requiresApproval(req: ActionRequest): boolean {
  return !checkAction(req).allowed;
}

/** Wallet / financial / auth actions are permanently un-approvable. */
export function canEverApprove(req: ActionRequest): boolean {
  if (isForbiddenSelector(req.selector)) return false;
  if (req.type === "click" || req.type === "submit" || req.type === "type" || req.type === "cookies" || req.type === "download") {
    return false; // mutating browser actions are not enabled in this build
  }
  return true;
}

export class ApprovalQueue {
  private readonly pending = new Map<string, ActionRequest>();

  request(id: string, req: ActionRequest): void {
    this.pending.set(id, req);
  }

  /** Returns false (and refuses) for anything that can never be approved. */
  approve(id: string): { ok: boolean; reason: string } {
    const req = this.pending.get(id);
    if (!req) return { ok: false, reason: "no such pending action" };
    if (!canEverApprove(req)) return { ok: false, reason: "wallet/financial/mutating action can never be approved" };
    this.pending.delete(id);
    return { ok: true, reason: "approved" };
  }

  list(): Array<{ id: string; req: ActionRequest }> {
    return [...this.pending.entries()].map(([id, req]) => ({ id, req }));
  }
}
