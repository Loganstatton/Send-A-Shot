import { db } from './pg';

// Who did what in the staff/admin tools — role changes, database restores,
// claim and request decisions, collection publishing. Append-only from the
// app's side; read at /admin/audit.
export async function logAdminAction(
  actorId: number | null, action: string, target?: { type: string; id: string | number }, detail?: string,
): Promise<void> {
  await db.prepare('INSERT INTO admin_audit_log (actor_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(actorId, action, target?.type ?? null, target ? String(target.id) : null, detail?.slice(0, 500) ?? null, new Date().toISOString());
}

export type AuditEntry = { id: number; actor_name: string | null; action: string; target_type: string | null; target_id: string | null; detail: string | null; created_at: string };

export async function getAuditLog(limit = 300): Promise<AuditEntry[]> {
  return (await db.prepare(`
    SELECT l.id, u.name AS actor_name, l.action, l.target_type, l.target_id, l.detail, l.created_at
    FROM admin_audit_log l LEFT JOIN users u ON u.id = l.actor_id
    ORDER BY l.created_at DESC, l.id DESC LIMIT ?
  `).all(limit)) as AuditEntry[];
}
