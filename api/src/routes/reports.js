import { Router } from 'express';
import { z } from 'zod';
import { many, one, tx } from '../db.js';
import { ah, notFound, tooMany } from '../lib/errors.js';
import { parse, uuid } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { notifyStaff, notifyUser } from '../services/notify.js';

const router = Router();
router.use(requireAuth);

const CATEGORY_LABEL = {
  overflow: 'Overflowing', damaged: 'Damaged bin', odour: 'Bad smell', sensor: 'Readings look wrong', blocked: 'Blocked access', other: 'Other',
};

const shape = (r) => ({
  id: r.id, stationId: r.station_id, stationCode: r.station_code, stationName: r.station_name,
  category: r.category, categoryLabel: CATEGORY_LABEL[r.category], description: r.description,
  status: r.status, reporterName: r.reporter_name, createdAt: r.created_at, resolvedAt: r.resolved_at,
});

const SELECT = `SELECT r.*, s.code AS station_code, s.name AS station_name, u.full_name AS reporter_name
  FROM problem_reports r JOIN stations s ON s.id = r.station_id LEFT JOIN users u ON u.id = r.user_id`;

router.post('/', ah(async (req, res) => {
  const body = parse(z.object({
    stationId: uuid,
    category: z.enum(['overflow', 'damaged', 'odour', 'sensor', 'blocked', 'other']),
    description: z.string().trim().max(500).default(''),
  }), req.body);
  const station = await one(`SELECT id, code, name FROM stations WHERE id = $1 AND status <> 'retired'`, [body.stationId]);
  if (!station) throw notFound('Station not found');
  const recent = await one(`SELECT count(*) AS n FROM problem_reports WHERE user_id = $1 AND created_at > now() - interval '1 hour'`, [req.user.id]);
  if (recent.n >= 5) throw tooMany('You have sent several reports in the last hour. Thanks, we are on it.');
  const report = await tx(async (db) => {
    const r = await db.one(
      `INSERT INTO problem_reports(station_id, user_id, category, description) VALUES ($1,$2,$3,$4) RETURNING id`,
      [station.id, req.user.id, body.category, body.description]
    );
    await notifyStaff(db, {
      stationId: station.id, category: 'bin', kind: 'problem_report',
      title: `${station.code}: ${CATEGORY_LABEL[body.category]}`,
      body: body.description.slice(0, 140) || station.name,
    });
    return r;
  });
  res.status(201).json({ report: shape(await one(`${SELECT} WHERE r.id = $1`, [report.id])) });
}));

router.get('/mine', ah(async (req, res) => {
  const rows = await many(`${SELECT} WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 50`, [req.user.id]);
  res.json({ reports: rows.map(shape) });
}));

router.get('/', requireRole('agency', 'admin'), ah(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['open', 'resolved', 'all']).default('open') }), req.query);
  const rows = await many(`${SELECT} ${status === 'all' ? '' : 'WHERE r.status = $1'} ORDER BY r.created_at DESC LIMIT 200`, status === 'all' ? [] : [status]);
  res.json({ reports: rows.map(shape) });
}));

router.post('/:id/resolve', requireRole('agency', 'admin'), ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const r = await one(`UPDATE problem_reports SET status = 'resolved', resolved_by = $2, resolved_at = now() WHERE id = $1 AND status = 'open' RETURNING *`, [id, req.user.id]);
  if (!r) throw notFound('Open report not found');
  if (r.user_id) {
    await tx((db) => notifyUser(db, r.user_id, {
      stationId: r.station_id, category: 'system', kind: 'report_resolved',
      title: 'Your report was resolved', body: 'Thanks for helping keep the bins working.',
    }));
  }
  await audit(req, 'report.resolve', 'report', id);
  res.json({ report: shape(await one(`${SELECT} WHERE r.id = $1`, [id])) });
}));

export default router;
