import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/db.js';

export function logAuditAction(
  adminUserId: string | null,
  action: string,
  entityType: string,
  entityId: string | null = null,
  details: Record<string, any> | null = null
): void {
  try {
    const db = getDb();
    let validAdminId = adminUserId;
    if (validAdminId) {
      const exists = db.prepare('SELECT id FROM admin_users WHERE id = ?').get(validAdminId);
      if (!exists) {
        validAdminId = null;
      }
    }
    const id = uuidv4();
    const now = new Date().toISOString();
    const detailsJson = details ? JSON.stringify(details) : null;

    db.prepare(`
      INSERT INTO audit_logs (id, admin_user_id, action, entity_type, entity_id, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, validAdminId, action, entityType, entityId, detailsJson, now);
  } catch (err) {
    console.error('[AuditService] Failed to record audit log:', err);
  }
}
