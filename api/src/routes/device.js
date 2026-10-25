import { Router } from 'express';
import { z } from 'zod';
import { one, tx } from '../db.js';
import { ah, forbidden, unauthorized, badRequest } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import { parse } from '../lib/validate.js';
import { deviceLimiter } from '../middleware/rateLimit.js';
import { applyTelemetry } from '../services/telemetry.js';

const router = Router();
router.use(deviceLimiter);

const STREAM_ALIASES = {
  general: 'general', residual: 'general', yellow: 'general',
  recyclable: 'recyclable', recyclables: 'recyclable', recycle: 'recyclable', blue: 'recyclable',
  organic: 'organic', food: 'organic', green: 'organic',
};

const compartmentSchema = z
  .object({
    stream: z.string().transform((s, ctx) => {
      const v = STREAM_ALIASES[String(s).toLowerCase()];
      if (!v) ctx.addIssue({ code: 'custom', message: 'stream must be general, recyclable or organic' });
      return v;
    }),
    fill_pct: z.number().min(0).max(100).optional(),
    distance_cm: z.number().min(0).max(500).optional(),
    lid_locked: z.boolean().optional(),
  })
  .refine((c) => c.fill_pct != null || c.distance_cm != null, 'Send fill_pct or distance_cm');

const telemetrySchema = z.object({
  station: z.string().max(32).optional(),
  fw: z.string().max(32).optional(),
  battery: z.number().int().min(0).max(100).optional(),
  solar_v: z.number().min(0).max(40).optional(),
  rssi: z.number().int().min(-150).max(0).optional(),
  temp_c: z.number().min(-40).max(125).optional(),
  compartments: z.array(compartmentSchema).min(1).max(3),
  events: z.array(z.string().max(32)).max(10).optional(),
});

// Device auth: "Authorization: Bearer blk_xxxxxxxx_..." or "X-Device-Key: blk_..."
async function deviceAuth(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const key = header.startsWith('Bearer ') ? header.slice(7).trim() : (req.get('x-device-key') || '').trim();
    if (!key || !key.startsWith('blk_') || key.length > 120) throw unauthorized('Missing or malformed device key');
    const row = await one(
      `SELECT d.id AS device_id, s.* FROM devices d JOIN stations s ON s.id = d.station_id
       WHERE d.key_hash = $1 AND d.revoked_at IS NULL`,
      [sha256(key)]
    );
    if (!row) throw unauthorized('Unknown or revoked device key');
    if (row.status === 'retired') throw forbidden('This station has been retired');
    req.station = row;
    next();
  } catch (err) {
    next(err);
  }
}

router.use(deviceAuth);

// Heartbeat / boot config. Lets firmware check its key and fetch lock state.
router.get('/config', ah(async (req, res) => {
  const s = req.station;
  const comps = await tx((db) => db.many('SELECT stream, locked, lock_threshold, unlock_threshold, near_full_threshold, empty_distance_cm, full_distance_cm FROM compartments WHERE station_id = $1 ORDER BY stream', [s.id]));
  await one('UPDATE devices SET last_used_at = now(), last_ip = $2 WHERE id = $1 RETURNING id', [s.device_id, req.ip]);
  res.json({
    ok: true,
    station: s.code,
    name: s.name,
    server_time: new Date().toISOString(),
    next_report_s: s.report_interval_s,
    maintenance: s.status === 'maintenance',
    lock: Object.fromEntries(comps.map((c) => [c.stream, c.locked])),
    compartments: comps.map((c) => ({
      stream: c.stream,
      lock_threshold: c.lock_threshold,
      unlock_threshold: c.unlock_threshold,
      near_full_threshold: c.near_full_threshold,
      empty_distance_cm: c.empty_distance_cm,
      full_distance_cm: c.full_distance_cm,
    })),
  });
}));

router.post('/telemetry', ah(async (req, res) => {
  const body = parse(telemetrySchema, req.body);
  const s = req.station;
  if (body.station && body.station.toUpperCase() !== s.code.toUpperCase()) {
    throw badRequest(`This key belongs to ${s.code}, not ${body.station}`);
  }
  const streamsSeen = new Set();
  for (const c of body.compartments) {
    if (streamsSeen.has(c.stream)) throw badRequest(`Duplicate compartment: ${c.stream}`);
    streamsSeen.add(c.stream);
  }
  const result = await tx(async (db) => {
    await db.query('UPDATE devices SET last_used_at = now(), last_ip = $2 WHERE id = $1', [s.device_id, req.ip]);
    // Lock the station row so two messages from one device apply in order
    const station = await db.one('SELECT * FROM stations WHERE id = $1 FOR UPDATE', [s.id]);
    return applyTelemetry(db, station, body);
  });
  res.json(result);
}));

export default router;
