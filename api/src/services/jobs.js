import { config } from '../config.js';
import { logger } from '../logger.js';
import { many, query, tx } from '../db.js';
import { notifyOrg, notifyStaff } from './notify.js';

// Mark stations offline when they miss several reports in a row.
export async function checkOffline() {
  const stale = await many(
    `SELECT * FROM stations
     WHERE status = 'active' AND NOT offline_alerted AND last_seen_at IS NOT NULL
       AND last_seen_at < now() - (report_interval_s * $1 || ' seconds')::interval`,
    [config.offlineAfterMultiplier]
  );
  for (const s of stale) {
    await tx(async (db) => {
      const claimed = await db.one('UPDATE stations SET offline_alerted = true WHERE id = $1 AND NOT offline_alerted RETURNING id', [s.id]);
      if (!claimed) return;
      const msg = {
        stationId: s.id, category: 'bin', kind: 'offline',
        title: `${s.code} went offline`,
        body: `No data since ${new Date(s.last_seen_at).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' })}. Check power and signal.`,
      };
      await notifyStaff(db, msg);
      await notifyOrg(db, s.collector_org_id, msg);
    });
  }
  if (stale.length) logger.info({ count: stale.length }, 'stations marked offline');
}

export async function cleanup() {
  const r1 = await query(`DELETE FROM readings WHERE recorded_at < now() - ($1 || ' days')::interval`, [String(config.readingRetentionDays)]);
  await query(`DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'`);
  await query(`DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'`);
  await query(`DELETE FROM notifications WHERE created_at < now() - interval '120 days'`);
  logger.info({ readingsDeleted: r1.rowCount }, 'cleanup done');
}

export function startJobs() {
  const safe = (fn, name) => () => fn().catch((err) => logger.error({ err }, `${name} job failed`));
  const t1 = setInterval(safe(checkOffline, 'offline'), 60_000);
  const t2 = setInterval(safe(cleanup, 'cleanup'), 6 * 3600_000);
  setTimeout(safe(cleanup, 'cleanup'), 30_000);
  return () => { clearInterval(t1); clearInterval(t2); };
}
