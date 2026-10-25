import { Router } from 'express';
import { z } from 'zod';
import { many, one, tx } from '../db.js';
import { ah, badRequest, tooMany } from '../lib/errors.js';
import { parse, name, phone, stream, uuid } from '../lib/validate.js';
import { publicUser } from '../lib/auth.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { notifyUser } from '../services/notify.js';
import { streamLabel } from '../services/labels.js';

const router = Router();
router.use(requireAuth);

router.patch('/', ah(async (req, res) => {
  const body = parse(z.object({
    fullName: name.optional(),
    phone,
    homeStationCode: z.string().trim().max(32).nullable().optional(),
  }), req.body);
  let stationId = req.user.home_station_id;
  if (body.homeStationCode !== undefined) {
    if (!body.homeStationCode) stationId = null;
    else {
      const st = await one(`SELECT id FROM stations WHERE upper(code) = upper($1) AND status <> 'retired'`, [body.homeStationCode]);
      if (!st) throw badRequest('Some fields need attention', { homeStationCode: 'No station with that code' });
      stationId = st.id;
    }
  }
  const user = await one(
    `UPDATE users SET full_name = COALESCE($2, full_name), phone = CASE WHEN $3::boolean THEN $4 ELSE phone END, home_station_id = $5
     WHERE id = $1 RETURNING *`,
    [req.user.id, body.fullName ?? null, 'phone' in body, body.phone ?? null, stationId]
  );
  res.json({ user: publicUser({ ...user, org_name: req.user.org_name }) });
}));

// Points history
router.get('/activity', ah(async (req, res) => {
  const rows = await many(
    `SELECT l.*, s.code AS station_code FROM points_ledger l LEFT JOIN stations s ON s.id = l.station_id
     WHERE l.user_id = $1 ORDER BY l.created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json({
    points: req.user.points,
    activity: rows.map((r) => ({ id: r.id, amount: r.amount, reason: r.reason, stream: r.stream, weightKg: r.weight_kg, stationCode: r.station_code, at: r.created_at })),
  });
}));

const DROP_POINTS = { recyclable: 10, organic: 6, general: 2 };
const DAILY_DROP_LIMIT = 4;

// Resident logs a sorted drop-off. Capped per day to keep points fair.
router.post('/drops', requireRole('resident'), ah(async (req, res) => {
  const body = parse(z.object({ stationId: uuid, stream, weightKg: z.number().min(0.1).max(50).optional() }), req.body);
  const result = await tx(async (db) => {
    await db.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    const station = await db.one(`SELECT id, code FROM stations WHERE id = $1 AND status = 'active'`, [body.stationId]);
    if (!station) throw badRequest('Station not found');
    const comp = await db.one('SELECT locked FROM compartments WHERE station_id = $1 AND stream = $2', [station.id, body.stream]);
    if (comp?.locked) throw badRequest(`The ${streamLabel(body.stream).toLowerCase()} compartment is locked right now. Use another one or try after pickup.`);
    const today = await db.one(
      `SELECT count(*) AS n FROM points_ledger WHERE user_id = $1 AND reason = 'drop'
       AND created_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'`,
      [req.user.id]
    );
    if (today.n >= DAILY_DROP_LIMIT) throw tooMany(`You have logged ${DAILY_DROP_LIMIT} drops today. Come back tomorrow.`);
    const amount = DROP_POINTS[body.stream];
    await db.query(
      `INSERT INTO points_ledger(user_id, station_id, amount, reason, stream, weight_kg) VALUES ($1,$2,$3,'drop',$4,$5)`,
      [req.user.id, station.id, amount, body.stream, body.weightKg ?? null]
    );
    const u = await db.one('UPDATE users SET points = points + $2 WHERE id = $1 RETURNING points', [req.user.id, amount]);
    await notifyUser(db, req.user.id, {
      stationId: station.id, category: 'reward', kind: 'points',
      title: `You earned ${amount} Loop points`,
      body: `For sorting ${streamLabel(body.stream).toLowerCase()} at ${station.code}.`,
    });
    return { amount, points: u.points };
  });
  res.status(201).json(result);
}));

export default router;
