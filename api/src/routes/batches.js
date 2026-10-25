import { Router } from 'express';
import { z } from 'zod';
import { many, one, tx } from '../db.js';
import { ah, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { parse, uuid } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { isStaff, requireAuth, requireRole } from '../middleware/auth.js';
import { notifyStaff } from '../services/notify.js';

const router = Router();
router.use(requireAuth, requireRole('recycler', 'agency', 'admin'));

const MATERIALS = ['pet', 'hdpe', 'nylon', 'paper', 'metal', 'glass', 'organic', 'mixed'];
const MATERIAL_LABEL = { pet: 'PET bottles', hdpe: 'HDPE containers', nylon: 'Nylon film', paper: 'Paper and cardboard', metal: 'Cans and metal', glass: 'Glass', organic: 'Organic (compost)', mixed: 'Mixed recyclables' };
// Filter chips in the app group materials like this
const GROUPS = { plastics: ['pet', 'hdpe', 'nylon', 'mixed'], paper: ['paper'], metal: ['metal'], glass: ['glass'], organic: ['organic'] };

const SELECT = `SELECT b.*, s.code AS station_code, s.name AS station_name, o.name AS reserved_by_name
  FROM batches b LEFT JOIN stations s ON s.id = b.station_id LEFT JOIN organizations o ON o.id = b.reserved_by_org`;

const shape = (b) => ({
  id: b.id, material: b.material, materialLabel: MATERIAL_LABEL[b.material], weightKg: b.weight_kg, area: b.area,
  stationCode: b.station_code, stationName: b.station_name, status: b.status, reservedByOrgId: b.reserved_by_org,
  reservedByName: b.reserved_by_name, reservedAt: b.reserved_at, collectedAt: b.collected_at, notes: b.notes, createdAt: b.created_at,
});

// Marketplace: available batches grouped by material
router.get('/', ah(async (req, res) => {
  const q = parse(z.object({ group: z.enum(['plastics', 'paper', 'metal', 'glass', 'organic', 'all']).default('all'), q: z.string().max(80).optional() }), req.query);
  const params = [];
  const where = [`b.status = 'available'`];
  if (q.group !== 'all') {
    params.push(GROUPS[q.group]);
    where.push(`b.material = ANY($${params.length})`);
  }
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`(b.area ILIKE $${params.length} OR s.name ILIKE $${params.length} OR s.code ILIKE $${params.length} OR b.material ILIKE $${params.length})`);
  }
  const rows = await many(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY b.created_at DESC LIMIT 300`, params);

  // Group by material for the cards
  const groups = {};
  for (const b of rows) {
    const g = (groups[b.material] ||= { material: b.material, materialLabel: MATERIAL_LABEL[b.material], weightKg: 0, batches: [], areas: new Set(), stations: new Set() });
    g.weightKg += b.weight_kg;
    g.batches.push(shape(b));
    if (b.area) g.areas.add(b.area);
    if (b.station_id) g.stations.add(b.station_id);
  }
  const materials = Object.values(groups)
    .map((g) => ({ ...g, weightKg: Math.round(g.weightKg * 10) / 10, areas: [...g.areas], stationCount: g.stations.size, stations: undefined }))
    .sort((a, b) => b.weightKg - a.weightKg);
  res.json({ materials });
}));

// My reservations plus a 5-week trend for the header chart
router.get('/mine', ah(async (req, res) => {
  const orgId = req.user.org_id;
  if (!orgId) return res.json({ batches: [], weekKg: 0, weeks: [] });
  const rows = await many(`${SELECT} WHERE b.reserved_by_org = $1 ORDER BY b.reserved_at DESC LIMIT 200`, [orgId]);
  const weeks = await many(
    `SELECT gs.wk, COALESCE(sum(b.weight_kg), 0) AS kg
     FROM generate_series(date_trunc('week', now()) - interval '4 weeks', date_trunc('week', now()), interval '1 week') AS gs(wk)
     LEFT JOIN batches b ON b.reserved_by_org = $1 AND date_trunc('week', b.reserved_at) = gs.wk
     GROUP BY gs.wk ORDER BY gs.wk`,
    [orgId]
  );
  res.json({
    batches: rows.map(shape),
    weekKg: Math.round((weeks.at(-1)?.kg || 0) * 10) / 10,
    weeks: weeks.map((w) => ({ week: w.wk, kg: Math.round(w.kg * 10) / 10 })),
  });
}));

// Reserve every available batch of one material at once (the "Reserve batch" button)
router.post('/reserve-material', requireRole('recycler'), ah(async (req, res) => {
  const { material } = parse(z.object({ material: z.enum(MATERIALS) }), req.body);
  if (!req.user.org_id) throw forbidden('Your account is not linked to a recycling company');
  const rows = await tx(async (db) => {
    const r = await db.many(
      `UPDATE batches SET status = 'reserved', reserved_by_org = $2, reserved_by_user = $3, reserved_at = now()
       WHERE material = $1 AND status = 'available' RETURNING id, weight_kg`,
      [material, req.user.org_id, req.user.id]
    );
    if (r.length) {
      const kg = r.reduce((s, b) => s + b.weight_kg, 0);
      await notifyStaff(db, { category: 'system', kind: 'batch_reserved', title: `${req.user.org_name || 'A recycler'} reserved ${Math.round(kg)} kg of ${MATERIAL_LABEL[material]}`, body: `${r.length} batch(es)` });
    }
    return r;
  });
  if (!rows.length) throw conflict('Those batches were just reserved by someone else');
  await audit(req, 'batch.reserve_material', 'batch', null, { material, count: rows.length });
  res.json({ reserved: rows.length, weightKg: rows.reduce((s, b) => s + b.weight_kg, 0) });
}));

router.post('/:id/reserve', requireRole('recycler'), ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  if (!req.user.org_id) throw forbidden('Your account is not linked to a recycling company');
  const b = await one(
    `UPDATE batches SET status = 'reserved', reserved_by_org = $2, reserved_by_user = $3, reserved_at = now()
     WHERE id = $1 AND status = 'available' RETURNING id`,
    [id, req.user.org_id, req.user.id]
  );
  if (!b) throw conflict('This batch is no longer available');
  await audit(req, 'batch.reserve', 'batch', id);
  res.json({ batch: shape(await one(`${SELECT} WHERE b.id = $1`, [id])) });
}));

async function ownBatch(req, id) {
  const b = await one('SELECT * FROM batches WHERE id = $1', [id]);
  if (!b) throw notFound('Batch not found');
  if (!isStaff(req.user) && b.reserved_by_org !== req.user.org_id) throw forbidden('This batch is reserved by another company');
  return b;
}

router.post('/:id/collected', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = await ownBatch(req, id);
  if (b.status !== 'reserved') throw badRequest('Only reserved batches can be marked collected');
  await one(`UPDATE batches SET status = 'collected', collected_at = now() WHERE id = $1 RETURNING id`, [id]);
  await audit(req, 'batch.collected', 'batch', id);
  res.json({ batch: shape(await one(`${SELECT} WHERE b.id = $1`, [id])) });
}));

router.post('/:id/release', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = await ownBatch(req, id);
  if (b.status !== 'reserved') throw badRequest('Only reserved batches can be released');
  await one(`UPDATE batches SET status = 'available', reserved_by_org = NULL, reserved_by_user = NULL, reserved_at = NULL WHERE id = $1 RETURNING id`, [id]);
  await audit(req, 'batch.release', 'batch', id);
  res.json({ batch: shape(await one(`${SELECT} WHERE b.id = $1`, [id])) });
}));

// Staff can list material by hand (e.g. from a manual sort)
router.post('/', requireRole('agency', 'admin'), ah(async (req, res) => {
  const body = parse(z.object({
    material: z.enum(MATERIALS), weightKg: z.number().positive().max(100000), area: z.string().trim().max(100).default(''),
    stationId: uuid.optional(), notes: z.string().max(300).optional(),
  }), req.body);
  const b = await one(
    `INSERT INTO batches(material, weight_kg, area, station_id, notes) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [body.material, body.weightKg, body.area, body.stationId || null, body.notes || null]
  );
  await audit(req, 'batch.create', 'batch', b.id);
  res.status(201).json({ batch: shape(await one(`${SELECT} WHERE b.id = $1`, [b.id])) });
}));

export default router;
