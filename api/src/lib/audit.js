import { query } from '../db.js';

// Record security relevant actions. Never throws (auditing must not break requests).
// actorId defaults to the signed-in user.
export async function audit(req, action, entity, entityId, meta, actorId) {
  try {
    await query(
      'INSERT INTO audit_log(actor_id, action, entity, entity_id, meta, ip) VALUES ($1,$2,$3,$4,$5,$6)',
      [actorId || req?.user?.id || null, action, entity || null, entityId ? String(entityId) : null, meta ? JSON.stringify(meta) : null, req?.ip || null]
    );
  } catch (err) {
    req?.log?.warn({ err }, 'audit write failed');
  }
}
