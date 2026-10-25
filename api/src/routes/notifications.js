import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { ah } from '../lib/errors.js';
import { parse, uuid } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', ah(async (req, res) => {
  const q = parse(z.object({
    category: z.enum(['bin', 'pickup', 'reward', 'system']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }), req.query);
  const params = [req.user.id];
  let filter = '';
  if (q.category) {
    params.push(q.category);
    filter = `AND n.category = $2`;
  }
  params.push(q.limit);
  const rows = await many(
    `SELECT n.*, s.code AS station_code FROM notifications n LEFT JOIN stations s ON s.id = n.station_id
     WHERE n.user_id = $1 ${filter} ORDER BY n.created_at DESC LIMIT $${params.length}`,
    params
  );
  const { unread } = await one('SELECT count(*) AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  res.json({
    unread,
    notifications: rows.map((n) => ({
      id: n.id, category: n.category, kind: n.kind, title: n.title, body: n.body,
      stationId: n.station_id, stationCode: n.station_code, read: !!n.read_at, at: n.created_at,
    })),
  });
}));

router.get('/unread-count', ah(async (req, res) => {
  const { unread } = await one('SELECT count(*) AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  res.json({ unread });
}));

router.post('/read-all', ah(async (req, res) => {
  await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  res.json({ ok: true });
}));

router.post('/:id/read', ah(async (req, res) => {
  await query('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL', [parse(uuid, req.params.id), req.user.id]);
  res.json({ ok: true });
}));

export default router;
