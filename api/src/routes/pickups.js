import { Router } from 'express';
import { z } from 'zod';
import { many, one, tx } from '../db.js';
import { ah, badRequest, forbidden, notFound } from '../lib/errors.js';
import { parse, stream, uuid } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { isStaff, requireAuth, requireRole } from '../middleware/auth.js';
import { PICKUP_SELECT, ensurePickup, pickupRow } from '../services/pickups.js';
import { notifyOrg, notifyResidents } from '../services/notify.js';
import { streamLabel } from '../services/labels.js';

const router = Router();
router.use(requireAuth, requireRole('collector', 'agency', 'admin'));

// Locked bins first, then fullest, then oldest request
const URGENCY = `ORDER BY CASE p.status WHEN 'en_route' THEN 0 ELSE 1 END, c.locked DESC NULLS LAST, c.fill_pct DESC NULLS LAST, p.requested_at ASC`;

async function loadPickup(id) {
  const p = await one(`${PICKUP_SELECT} WHERE p.id = $1`, [id]);
  if (!p) throw notFound('Pickup not found');
  return p;
}

function assertCanWork(user, p) {
  if (isStaff(user)) return;
  if (!user.org_id || p.collector_org_id !== user.org_id) throw forbidden('This pickup belongs to another company');
}

router.get('/', ah(async (req, res) => {
  const q = parse(z.object({
    status: z.enum(['open', 'completed', 'cancelled', 'all']).default('open'),
    days: z.coerce.number().int().min(1).max(365).default(7),
    stationId: uuid.optional(),
  }), req.query);
  const where = [];
  const params = [];
  if (q.status === 'open') where.push(`p.status IN ('pending','assigned','en_route')`);
  else if (q.status !== 'all') {
    params.push(q.status);
    where.push(`p.status = $${params.length}`);
  }
  if (q.status !== 'open') {
    params.push(String(q.days));
    where.push(`p.requested_at > now() - ($${params.length} || ' days')::interval`);
  }
  if (q.stationId) {
    params.push(q.stationId);
    where.push(`p.station_id = $${params.length}`);
  }
  if (!isStaff(req.user)) {
    if (!req.user.org_id) return res.json({ pickups: [] });
    params.push(req.user.org_id);
    where.push(`p.collector_org_id = $${params.length}`);
  }
  const rows = await many(`${PICKUP_SELECT} WHERE ${where.join(' AND ')} ${q.status === 'open' ? URGENCY : 'ORDER BY p.requested_at DESC'} LIMIT 500`, params);
  res.json({ pickups: rows.map(pickupRow) });
}));

// Today's numbers for the collector header
router.get('/summary', ah(async (req, res) => {
  const scope = isStaff(req.user) ? '' : 'AND p.collector_org_id = $1';
  const params = isStaff(req.user) ? [] : [req.user.org_id];
  if (!isStaff(req.user) && !req.user.org_id) return res.json({ open: 0, locked: 0, doneToday: 0, enRoute: 0 });
  const row = await one(
    `SELECT
       count(*) FILTER (WHERE p.status IN ('pending','assigned','en_route')) AS open,
       count(*) FILTER (WHERE p.status IN ('pending','assigned','en_route') AND c.locked) AS locked,
       count(*) FILTER (WHERE p.status = 'en_route') AS en_route,
       count(*) FILTER (WHERE p.status = 'completed' AND p.completed_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos') AS done_today
     FROM pickups p LEFT JOIN compartments c ON c.station_id = p.station_id AND c.stream = p.stream
     WHERE true ${scope}`,
    params
  );
  res.json({ open: row.open, locked: row.locked, enRoute: row.en_route, doneToday: row.done_today });
}));

// Staff: request a pickup by hand
router.post('/', requireRole('agency', 'admin'), ah(async (req, res) => {
  const body = parse(z.object({ stationId: uuid, stream, notes: z.string().max(300).optional() }), req.body);
  const result = await tx(async (db) => {
    const station = await db.one('SELECT * FROM stations WHERE id = $1', [body.stationId]);
    if (!station) throw notFound('Station not found');
    const comp = await db.one('SELECT fill_pct FROM compartments WHERE station_id = $1 AND stream = $2', [station.id, body.stream]);
    return ensurePickup(db, station, body.stream, { fill: comp?.fill_pct, source: 'manual', createdBy: req.user.id, notes: body.notes });
  });
  await audit(req, 'pickup.create', 'pickup', result.pickup.id);
  res.status(result.created ? 201 : 200).json({ pickup: pickupRow(await loadPickup(result.pickup.id)), created: result.created });
}));

router.post('/:id/assign', requireRole('agency', 'admin'), ah(async (req, res) => {
  const { orgId } = parse(z.object({ orgId: uuid }), req.body);
  const p = await loadPickup(parse(uuid, req.params.id));
  if (!['pending', 'assigned'].includes(p.status)) throw badRequest('Only waiting pickups can be reassigned');
  const org = await one(`SELECT * FROM organizations WHERE id = $1 AND kind = 'collector'`, [orgId]);
  if (!org) throw badRequest('Pick a collection company');
  await tx(async (db) => {
    await db.query(`UPDATE pickups SET collector_org_id = $2, collector_user_id = NULL, status = 'assigned', assigned_at = now() WHERE id = $1`, [p.id, org.id]);
    await notifyOrg(db, org.id, {
      stationId: p.station_id, category: 'pickup', kind: 'pickup_assigned',
      title: `New pickup: ${p.station_code}`, body: `${streamLabel(p.stream)} at ${p.station_name} is at ${p.current_fill ?? '?'}%.`,
    });
    await notifyResidents(db, p.station_id, {
      category: 'pickup', kind: 'pickup_assigned',
      title: `Pickup assigned to ${org.name}`, body: `${streamLabel(p.stream)} compartment is scheduled for collection.`,
    });
  });
  await audit(req, 'pickup.assign', 'pickup', p.id, { orgId });
  res.json({ pickup: pickupRow(await loadPickup(p.id)) });
}));

// Collector heads out to one stop
router.post('/:id/start', ah(async (req, res) => {
  const { etaMinutes } = parse(z.object({ etaMinutes: z.number().int().min(1).max(24 * 60).optional() }), req.body || {});
  const p = await loadPickup(parse(uuid, req.params.id));
  assertCanWork(req.user, p);
  if (!['assigned', 'pending'].includes(p.status)) throw badRequest('This pickup has already started or finished');
  await startPickup(req.user, p, etaMinutes);
  res.json({ pickup: pickupRow(await loadPickup(p.id)) });
}));

async function startPickup(user, p, etaMinutes) {
  await tx(async (db) => {
    await db.query(
      `UPDATE pickups SET status = 'en_route', started_at = now(), collector_user_id = $2,
         collector_org_id = COALESCE(collector_org_id, $3),
         eta = CASE WHEN $4::int IS NULL THEN eta ELSE now() + ($4::int || ' minutes')::interval END
       WHERE id = $1`,
      [p.id, user.id, user.org_id, etaMinutes ?? null]
    );
    const when = etaMinutes ? new Date(Date.now() + etaMinutes * 60000).toLocaleTimeString('en-US', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit' }) : null;
    await notifyResidents(db, p.station_id, {
      category: 'pickup', kind: 'en_route',
      title: `${p.collector_org_name || 'Collector'} is on the way`,
      body: when ? `Expected around ${when} for the ${streamLabel(p.stream).toLowerCase()} compartment.` : `Heading to ${p.station_code} for the ${streamLabel(p.stream).toLowerCase()} compartment.`,
    });
  });
}

// Start the whole route: every assigned pickup for my company goes en route
router.post('/start-route', requireRole('collector'), ah(async (req, res) => {
  if (!req.user.org_id) throw forbidden('Your account is not linked to a collection company');
  const rows = await many(`${PICKUP_SELECT} WHERE p.collector_org_id = $1 AND p.status = 'assigned' ${URGENCY}`, [req.user.org_id]);
  for (const p of rows) await startPickup(req.user, p, null);
  await audit(req, 'pickup.start_route', 'org', req.user.org_id, { count: rows.length });
  res.json({ started: rows.length });
}));

router.post('/:id/complete', ah(async (req, res) => {
  const body = parse(z.object({
    weightKg: z.number().min(0).max(5000).optional(),
    material: z.enum(['pet', 'hdpe', 'nylon', 'paper', 'metal', 'glass', 'organic', 'mixed']).optional(),
    notes: z.string().max(300).optional(),
  }), req.body || {});
  const p = await loadPickup(parse(uuid, req.params.id));
  assertCanWork(req.user, p);
  if (['completed', 'cancelled'].includes(p.status)) throw badRequest('This pickup is already closed');

  await tx(async (db) => {
    await db.query(
      `UPDATE pickups SET status = 'completed', completed_at = now(), weight_kg = $2, material = $3,
         notes = COALESCE($4, notes), collector_user_id = COALESCE(collector_user_id, $5),
         started_at = COALESCE(started_at, now())
       WHERE id = $1`,
      [p.id, body.weightKg ?? null, body.material ?? null, body.notes ?? null, req.user.id]
    );
    // Collector says it is empty: release the full-lock now. The next sensor
    // reading is the source of truth and will re-lock if it is still full.
    await db.query(
      `UPDATE compartments SET fill_pct = 0, locked = false, lock_reason = NULL, locked_at = NULL, updated_at = now()
       WHERE station_id = $1 AND stream = $2 AND (lock_reason IS NULL OR lock_reason = 'full')`,
      [p.station_id, p.stream]
    );
    // Sorted recyclables and organics become batches recyclers can reserve
    if (body.weightKg && body.weightKg > 0 && p.stream !== 'general') {
      const material = p.stream === 'organic' ? 'organic' : (body.material || 'mixed');
      await db.query(
        `INSERT INTO batches(material, weight_kg, area, station_id, pickup_id) VALUES ($1,$2,$3,$4,$5)`,
        [material, body.weightKg, p.station_area || '', p.station_id, p.id]
      );
    }
    await notifyResidents(db, p.station_id, {
      category: 'pickup', kind: 'pickup_completed',
      title: `${streamLabel(p.stream)} pickup completed`,
      body: `Emptied by ${p.collector_org_name || 'the collector'}. Lid unlocked.`,
    });
  });
  await audit(req, 'pickup.complete', 'pickup', p.id, body);
  res.json({ pickup: pickupRow(await loadPickup(p.id)) });
}));

router.post('/:id/cancel', requireRole('agency', 'admin'), ah(async (req, res) => {
  const p = await loadPickup(parse(uuid, req.params.id));
  if (['completed', 'cancelled'].includes(p.status)) throw badRequest('This pickup is already closed');
  await one(`UPDATE pickups SET status = 'cancelled' WHERE id = $1 RETURNING id`, [p.id]);
  await audit(req, 'pickup.cancel', 'pickup', p.id);
  res.json({ pickup: pickupRow(await loadPickup(p.id)) });
}));

export default router;
