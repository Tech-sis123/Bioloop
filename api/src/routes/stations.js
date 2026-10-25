import { Router } from 'express';
import { z } from 'zod';
import { many, one, tx } from '../db.js';
import { ah, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { parse, stream, streams, uuid } from '../lib/validate.js';
import { newDeviceKey } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';
import { isStaff, requireAuth, requireRole } from '../middleware/auth.js';
import { STATION_SELECT, hydrateStations } from '../services/stations.js';
import { notifyResidents } from '../services/notify.js';
import { streamLabel } from '../services/labels.js';

const router = Router();
router.use(requireAuth);

const staffOnly = requireRole('agency', 'admin');

async function findStation(idOrCode) {
  const isUuid = uuid.safeParse(idOrCode).success;
  return one(`${STATION_SELECT} WHERE ${isUuid ? 's.id = $1' : 'upper(s.code) = upper($1)'}`, [idOrCode]);
}

// List stations. Everyone signed in can see station locations and fill levels
// (residents use it for "Find a bin"). Device details are staff only.
router.get('/', ah(async (req, res) => {
  const q = parse(z.object({
    q: z.string().max(80).optional(),
    status: z.enum(['active', 'maintenance', 'retired', 'all']).optional(),
    mine: z.enum(['1', 'true']).optional(),
    needs: z.enum(['locked', 'near_full', 'offline']).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  }), req.query);

  const where = [];
  const params = [];
  const status = q.status || 'active';
  if (status !== 'all') {
    params.push(status);
    where.push(`s.status = $${params.length}`);
  } else if (!isStaff(req.user)) {
    where.push(`s.status <> 'retired'`);
  }
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`(s.code ILIKE $${params.length} OR s.name ILIKE $${params.length} OR s.area ILIKE $${params.length})`);
  }
  if (q.mine && req.user.org_id) {
    params.push(req.user.org_id);
    where.push(`s.collector_org_id = $${params.length}`);
  }
  params.push(q.limit || 300);
  const rows = await many(
    `${STATION_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.code LIMIT $${params.length}`,
    params
  );
  let list = await hydrateStations(rows, { staff: isStaff(req.user) });
  if (q.needs === 'locked') list = list.filter((s) => s.anyLocked);
  if (q.needs === 'near_full') list = list.filter((s) => !s.anyLocked && s.compartments.some((c) => c.fillPct >= c.nearFullThreshold));
  if (q.needs === 'offline') list = list.filter((s) => !s.online);
  res.json({ stations: list });
}));

router.get('/:id', ah(async (req, res) => {
  const row = await findStation(req.params.id);
  if (!row || (row.status === 'retired' && !isStaff(req.user))) throw notFound('Station not found');
  const [station] = await hydrateStations([row], { staff: isStaff(req.user) });
  res.json({ station });
}));

// Fill history for charts
router.get('/:id/readings', requireRole('agency', 'admin', 'collector'), ah(async (req, res) => {
  const { hours } = parse(z.object({ hours: z.coerce.number().int().min(1).max(24 * 30).default(24) }), req.query);
  const row = await findStation(req.params.id);
  if (!row) throw notFound('Station not found');
  const readings = await many(
    `SELECT stream, fill_pct, recorded_at FROM readings
     WHERE station_id = $1 AND recorded_at > now() - ($2 || ' hours')::interval
     ORDER BY recorded_at ASC LIMIT 5000`,
    [row.id, String(hours)]
  );
  res.json({ readings: readings.map((r) => ({ stream: r.stream, fillPct: r.fill_pct, at: r.recorded_at })) });
}));

const stationFields = {
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,24}$/, 'Use letters, numbers and dashes, e.g. BL-049'),
  name: z.string().trim().min(2).max(100),
  area: z.string().trim().max(100).optional(),
  zone: z.string().trim().max(60).optional(),
  address: z.string().trim().max(200).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  collectorOrgId: uuid.nullable().optional(),
  reportIntervalS: z.number().int().min(30).max(86400).optional(),
  status: z.enum(['active', 'maintenance', 'retired']).optional(),
};

async function checkCollectorOrg(orgId) {
  if (!orgId) return;
  const org = await one('SELECT kind FROM organizations WHERE id = $1', [orgId]);
  if (!org || org.kind !== 'collector') throw badRequest('Some fields need attention', { collectorOrgId: 'Pick a collection company' });
}

// Create a station + its 3 compartments + a device key (shown once).
router.post('/', staffOnly, ah(async (req, res) => {
  const body = parse(z.object(stationFields), req.body);
  await checkCollectorOrg(body.collectorOrgId);
  const exists = await one('SELECT 1 FROM stations WHERE upper(code) = upper($1)', [body.code]);
  if (exists) throw conflict(`Station ${body.code} already exists`);
  const key = newDeviceKey();
  const id = await tx(async (db) => {
    const s = await db.one(
      `INSERT INTO stations(code, name, area, zone, address, lat, lng, collector_org_id, report_interval_s, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [body.code, body.name, body.area || '', body.zone || 'Lagos', body.address || '', body.lat ?? null, body.lng ?? null,
        body.collectorOrgId || null, body.reportIntervalS || 300, body.status || 'active']
    );
    for (const st of streams) await db.query('INSERT INTO compartments(station_id, stream) VALUES ($1,$2)', [s.id, st]);
    await db.query('INSERT INTO devices(station_id, key_prefix, key_hash) VALUES ($1,$2,$3)', [s.id, key.prefix, key.hash]);
    return s.id;
  });
  await audit(req, 'station.create', 'station', id, { code: body.code });
  const [station] = await hydrateStations([await findStation(id)], { staff: true });
  res.status(201).json({ station, deviceKey: key.key });
}));

router.patch('/:id', staffOnly, ah(async (req, res) => {
  const body = parse(z.object(stationFields).partial().omit({ code: true }), req.body);
  const row = await findStation(req.params.id);
  if (!row) throw notFound('Station not found');
  if ('collectorOrgId' in body) await checkCollectorOrg(body.collectorOrgId);
  const map = { name: 'name', area: 'area', zone: 'zone', address: 'address', lat: 'lat', lng: 'lng', collectorOrgId: 'collector_org_id', reportIntervalS: 'report_interval_s', status: 'status' };
  const sets = [];
  const params = [row.id];
  for (const [k, col] of Object.entries(map)) {
    if (k in body) {
      params.push(body[k] ?? null);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (sets.length) await one(`UPDATE stations SET ${sets.join(', ')} WHERE id = $1 RETURNING id`, params);
  // Hand open, unassigned pickups to the newly assigned company
  if (body.collectorOrgId) {
    await one(`UPDATE pickups SET collector_org_id = $2, status = 'assigned', assigned_at = now()
               WHERE station_id = $1 AND status = 'pending' RETURNING id`, [row.id, body.collectorOrgId]);
  }
  await audit(req, 'station.update', 'station', row.id, body);
  const [station] = await hydrateStations([await findStation(row.id)], { staff: true });
  res.json({ station });
}));

// Calibrate a compartment or lock/unlock it by hand.
router.patch('/:id/compartments/:stream', staffOnly, ah(async (req, res) => {
  const st = parse(stream, req.params.stream);
  const body = parse(z.object({
    emptyDistanceCm: z.number().min(1).max(500).optional(),
    fullDistanceCm: z.number().min(0).max(500).optional(),
    lockThreshold: z.number().int().min(50).max(100).optional(),
    unlockThreshold: z.number().int().min(0).max(90).optional(),
    nearFullThreshold: z.number().int().min(10).max(99).optional(),
    manualLock: z.boolean().optional(),
  }), req.body);
  const row = await findStation(req.params.id);
  if (!row) throw notFound('Station not found');
  const comp = await one('SELECT * FROM compartments WHERE station_id = $1 AND stream = $2', [row.id, st]);
  if (!comp) throw notFound('Compartment not found');

  const next = {
    empty: body.emptyDistanceCm ?? comp.empty_distance_cm,
    full: body.fullDistanceCm ?? comp.full_distance_cm,
    lock: body.lockThreshold ?? comp.lock_threshold,
    unlock: body.unlockThreshold ?? comp.unlock_threshold,
    near: body.nearFullThreshold ?? comp.near_full_threshold,
  };
  if (next.full >= next.empty) throw badRequest('Some fields need attention', { fullDistanceCm: 'Full distance must be smaller than empty distance' });
  if (next.unlock >= next.lock) throw badRequest('Some fields need attention', { unlockThreshold: 'Unlock level must be below the lock level' });
  if (next.near >= next.lock) throw badRequest('Some fields need attention', { nearFullThreshold: 'Near-full level must be below the lock level' });

  let locked = comp.locked;
  let reason = comp.lock_reason;
  if (body.manualLock === true) { locked = true; reason = 'manual'; }
  if (body.manualLock === false) {
    // Releasing a manual lock: fall back to automatic behaviour for the current fill
    reason = comp.fill_pct >= next.lock ? 'full' : null;
    locked = reason === 'full';
  }

  await one(
    `UPDATE compartments SET empty_distance_cm = $3, full_distance_cm = $4, lock_threshold = $5, unlock_threshold = $6,
       near_full_threshold = $7, locked = $8, lock_reason = $9,
       locked_at = CASE WHEN $8 AND NOT locked THEN now() WHEN NOT $8 THEN NULL ELSE locked_at END
     WHERE id = $1 AND station_id = $2 RETURNING id`,
    [comp.id, row.id, next.empty, next.full, next.lock, next.unlock, next.near, locked, reason]
  );
  if (body.manualLock !== undefined && locked !== comp.locked) {
    await tx((db) => notifyResidents(db, row.id, {
      category: 'bin', kind: locked ? 'manual_lock' : 'unlocked',
      title: `${streamLabel(st)} compartment ${locked ? 'closed for maintenance' : 'open again'}`,
      body: `${row.code} ${row.name}`,
    }));
  }
  await audit(req, 'compartment.update', 'station', row.id, { stream: st, ...body });
  const [station] = await hydrateStations([await findStation(row.id)], { staff: true });
  res.json({ station });
}));

// Issue a new device key. The old key stops working immediately.
router.post('/:id/device-key', staffOnly, ah(async (req, res) => {
  const row = await findStation(req.params.id);
  if (!row) throw notFound('Station not found');
  if (row.status === 'retired') throw forbidden('Station is retired');
  const key = newDeviceKey();
  await tx(async (db) => {
    await db.query('UPDATE devices SET revoked_at = now() WHERE station_id = $1 AND revoked_at IS NULL', [row.id]);
    await db.query('INSERT INTO devices(station_id, key_prefix, key_hash) VALUES ($1,$2,$3)', [row.id, key.prefix, key.hash]);
  });
  await audit(req, 'device.key_rotated', 'station', row.id);
  res.json({ deviceKey: key.key, keyPrefix: key.prefix });
}));

export default router;
