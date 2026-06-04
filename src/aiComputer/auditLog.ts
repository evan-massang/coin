import type { DB } from "../store/db.js";

// Append-only audit of every AI Computer action decision (allowed or blocked),
// with the screenshot evidence id. Nothing the agent does is unlogged.
export interface AuditEntry {
  id?: number;
  at: number;
  taskId?: string;
  actionType: string;
  url?: string;
  selector?: string;
  allowed: boolean;
  reason: string;
  screenshotPath?: string;
  approved?: boolean;
}

export class AuditLog {
  constructor(private readonly db: DB) {}

  record(e: AuditEntry): number {
    const info = this.db
      .prepare(
        `INSERT INTO ai_audit_log(at, task_id, action_type, url, selector, allowed, reason, screenshot_path, approved)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        e.at,
        e.taskId ?? null,
        e.actionType,
        e.url ?? null,
        e.selector ?? null,
        e.allowed ? 1 : 0,
        e.reason,
        e.screenshotPath ?? null,
        e.approved ? 1 : 0,
      );
    return Number(info.lastInsertRowid);
  }

  list(limit = 200): AuditEntry[] {
    const rows = this.db.prepare("SELECT * FROM ai_audit_log ORDER BY at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      at: r.at as number,
      taskId: (r.task_id as string) ?? undefined,
      actionType: r.action_type as string,
      url: (r.url as string) ?? undefined,
      selector: (r.selector as string) ?? undefined,
      allowed: (r.allowed as number) === 1,
      reason: r.reason as string,
      screenshotPath: (r.screenshot_path as string) ?? undefined,
      approved: (r.approved as number) === 1,
    }));
  }
}
