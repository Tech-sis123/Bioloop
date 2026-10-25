import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { many, one } from '../db.js';
import { ah, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { parse, email, name, phone, uuid } from '../lib/validate.js';
import { hashPassword, publicUser, revokeAllSessions } from '../lib/auth.js';
import { randomToken } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { STATION_SELECT, hydrateStations } from '../services/stations.js';
import { PICKUP_SELECT, pickupRow } from '../services/pickups.js';
import { createResetLink } from './auth.js';
import { sendMail } from '../lib/mail.js';

const router = Router();
router.use(requireAuth, requireRole('agency', 'admin'));

// Dashboard headline numbers
router.get('/overview', ah(async (req, res) => {
  const rows = await many(`${STATION_SELECT} WHERE s.status = 'active'`);
  const stations = await hydrateStations(rows, { staff: true });
  const online = stations.filter((s) => s.online).length;
  const lockedComps = stations.flatMap((s) => s.compartments.filter((c) => c.locked).map((c) => ({ ...c, station: s })));
  const oldestLock = lockedComps.reduce((min, c) => (c.lockedAt && (!min || new Date(c.lockedAt) < min) ? new Date(c.lockedAt) : min), null);
  const nearFull = stations.filter((s) => s.compartments.some((c) => !c.locked && c.fillPct >= c.nearFullThreshold)).length;

  const today = await one(
    `SELECT count(*) FILTER (WHERE status = 'completed' AND completed_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos') AS done,
            count(*) FILTER (WHERE status = 'en_route') AS en_route,
            count(*) FILTER (WHERE status IN ('pending','assigned')) AS waiting
     FROM pickups`
  );
  const week = await many(
    `SELECT stream, COALESCE(sum(weight_kg), 0) AS kg, count(*) AS n FROM pickups
     WHERE status = 'completed' AND completed_at > now() - interval '7 days' GROUP BY stream`
  );
  const recyclersServed = await one(`SELECT count(DISTINCT reserved_by_org) AS n FROM batches WHERE reserved_at > now() - interval '7 days'`);
  const openReports = await one(`SELECT count(*) AS n FROM problem_reports WHERE status = 'open'`);
  const needs = await many(`${PICKUP_SELECT} WHERE p.status IN ('pending','assigned','en_route')
    ORDER BY c.locked DESC NULLS LAST, c.fill_pct DESC NULLS LAST, p.requested_at ASC LIMIT 20`);

  res.json({
    stationsTotal: stations.length,
    stationsOnline: online,
    lockedBins: new Set(lockedComps.map((c) => c.station.id)).size,
    lockedCompartments: lockedComps.length,
    oldestLockedAt: oldestLock,
    nearFull,
    pickupsDoneToday: today.done,
    pickupsEnRoute: today.en_route,
    pickupsWaiting: today.waiting,
    openReports: openReports.n,
    recyclersServedWeek: recyclersServed.n,
    week: ['general', 'recyclable', 'organic'].map((st) => {
      const w = week.find((r) => r.stream === st);
      return { stream: st, kg: Math.round((w?.kg || 0) * 10) / 10, pickups: w?.n || 0 };
    }),
    needsPickup: needs.map(pickupRow),
    map: stations.map((s) => ({
      id: s.id, code: s.code, name: s.name, lat: s.lat, lng: s.lng, online: s.online, maxFill: s.maxFill, anyLocked: s.anyLocked,
      nearFull: s.compartments.some((c) => c.fillPct >= c.nearFullThreshold),
    })),
  });
}));

// CSV export of pickups (for reports to government / partners)
router.get('/export/pickups.csv', ah(async (req, res) => {
  const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
  const rows = await many(`${PICKUP_SELECT} WHERE p.requested_at > now() - ($1 || ' days')::interval ORDER BY p.requested_at DESC`, [String(days)]);
  const cols = ['requested_at', 'station_code', 'station_name', 'station_area', 'stream', 'status', 'collector_org_name', 'fill_at_request', 'weight_kg', 'material', 'completed_at', 'source'];
  // Guard against CSV formula injection in spreadsheet apps
  const cell = (v) => {
    if (v == null) return '';
    let s = v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
  await audit(req, 'export.pickups', null, null, { days, rows: rows.length });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="bioloop-pickups-${days}d.csv"`);
  res.send(csv);
}));

/* ---------- Organisations ---------- */

const orgSchema = z.object({
  name: z.string().trim().min(2).max(100),
  kind: z.enum(['agency', 'collector', 'recycler']),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  area: z.string().trim().max(100).optional(),
});

router.get('/orgs', ah(async (req, res) => {
  const { kind } = parse(z.object({ kind: z.enum(['agency', 'collector', 'recycler']).optional() }), req.query);
  const rows = await many(
    `SELECT o.*,
       (SELECT count(*) FROM users u WHERE u.org_id = o.id) AS members,
       (SELECT count(*) FROM stations s WHERE s.collector_org_id = o.id AND s.status <> 'retired') AS stations,
       (SELECT count(*) FROM pickups p WHERE p.collector_org_id = o.id AND p.status IN ('pending','assigned','en_route')) AS open_pickups,
       (SELECT count(*) FROM pickups p WHERE p.collector_org_id = o.id AND p.status = 'completed' AND p.completed_at > now() - interval '7 days') AS done_week,
       (SELECT COALESCE(sum(weight_kg),0) FROM batches b WHERE b.reserved_by_org = o.id AND b.reserved_at > now() - interval '30 days') AS reserved_kg_30d
     FROM organizations o ${kind ? 'WHERE o.kind = $1' : ''} ORDER BY o.name`,
    kind ? [kind] : []
  );
  res.json({
    orgs: rows.map((o) => ({
      id: o.id, name: o.name, kind: o.kind, phone: o.phone, area: o.area, members: o.members, stations: o.stations,
      openPickups: o.open_pickups, doneWeek: o.done_week, reservedKg30d: Math.round(o.reserved_kg_30d), createdAt: o.created_at,
    })),
  });
}));

router.post('/orgs', ah(async (req, res) => {
  const body = parse(orgSchema, req.body);
  if (body.kind === 'agency' && req.user.role !== 'admin') throw forbidden('Only admins can add agencies');
  const o = await one(`INSERT INTO organizations(name, kind, phone, area) VALUES ($1,$2,$3,$4) RETURNING *`, [body.name, body.kind, body.phone || null, body.area || null]);
  await audit(req, 'org.create', 'org', o.id, body);
  res.status(201).json({ org: o });
}));

router.patch('/orgs/:id', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(orgSchema.partial().omit({ kind: true }), req.body);
  const o = await one(
    `UPDATE organizations SET name = COALESCE($2, name), phone = COALESCE($3, phone), area = COALESCE($4, area) WHERE id = $1 RETURNING *`,
    [id, body.name ?? null, body.phone ?? null, body.area ?? null]
  );
  if (!o) throw notFound('Organisation not found');
  await audit(req, 'org.update', 'org', id, body);
  res.json({ org: o });
}));

/* ---------- Users ---------- */

const ROLE_ORG_KIND = { collector: 'collector', recycler: 'recycler', agency: 'agency' };

// Agency staff can manage residents, collectors and recyclers. Only admins can
// create or change agency/admin accounts.
function assertCanManageRole(actor, role) {
  if (actor.role === 'admin') return;
  if (['agency', 'admin'].includes(role)) throw forbidden('Only admins can manage agency and admin accounts');
}

async function checkOrgForRole(role, orgId) {
  const kind = ROLE_ORG_KIND[role];
  if (!kind) return null;
  if (!orgId) {
    if (role === 'agency') return null;
    throw badRequest('Some fields need attention', { orgId: `Pick a ${kind === 'collector' ? 'collection company' : 'recycling company'}` });
  }
  const org = await one('SELECT kind FROM organizations WHERE id = $1', [orgId]);
  if (!org || org.kind !== kind) throw badRequest('Some fields need attention', { orgId: 'That organisation does not match this role' });
  return orgId;
}

router.get('/users', ah(async (req, res) => {
  const q = parse(z.object({ role: z.enum(['resident', 'collector', 'recycler', 'agency', 'admin']).optional(), q: z.string().max(80).optional() }), req.query);
  const params = [];
  const where = [];
  if (q.role) { params.push(q.role); where.push(`u.role = $${params.length}`); }
  if (q.q) { params.push(`%${q.q}%`); where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
  const rows = await many(
    `SELECT u.*, o.name AS org_name, s.code AS home_station_code FROM users u
     LEFT JOIN organizations o ON o.id = u.org_id LEFT JOIN stations s ON s.id = u.home_station_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.created_at DESC LIMIT 300`,
    params
  );
  res.json({ users: rows.map((u) => ({ ...publicUser(u), homeStationCode: u.home_station_code })) });
}));

// Create an account. Returns a one-time setup link (and emails it if email is configured).
router.post('/users', ah(async (req, res) => {
  const body = parse(z.object({
    fullName: name, email, phone,
    role: z.enum(['resident', 'collector', 'recycler', 'agency', 'admin']),
    orgId: uuid.optional().nullable(),
  }), req.body);
  assertCanManageRole(req.user, body.role);
  const orgId = await checkOrgForRole(body.role, body.orgId);
  if (await one('SELECT 1 FROM users WHERE email = $1', [body.email])) throw conflict('An account with this email already exists');
  // Random unusable password until the person sets their own through the link
  const user = await one(
    `INSERT INTO users(email, phone, full_name, password_hash, role, org_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [body.email, body.phone || null, body.fullName, await hashPassword(randomToken(24)), body.role, orgId]
  );
  const link = await createResetLink(user.id);
  let emailed = false;
  try {
    const r = await sendMail({ to: user.email, subject: 'Your BioLoop account', text: `Hi ${user.full_name},\n\nAn account has been created for you on BioLoop. Set your password here (link valid for 1 hour):\n\n${link}\n` });
    emailed = !!r.sent;
  } catch (err) {
    req.log.warn({ err }, 'invite email failed');
  }
  await audit(req, 'user.create', 'user', user.id, { role: body.role });
  res.status(201).json({ user: publicUser(user), setupLink: link, emailed });
}));

router.patch('/users/:id', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(z.object({
    fullName: name.optional(), phone,
    role: z.enum(['resident', 'collector', 'recycler', 'agency', 'admin']).optional(),
    orgId: uuid.nullable().optional(),
    isActive: z.boolean().optional(),
  }), req.body);
  const target = await one('SELECT * FROM users WHERE id = $1', [id]);
  if (!target) throw notFound('User not found');
  if (target.id === req.user.id && (body.role || body.isActive === false)) throw forbidden('You cannot change your own role or deactivate yourself');
  assertCanManageRole(req.user, target.role);
  const role = body.role || target.role;
  assertCanManageRole(req.user, role);
  const orgId = (body.role || 'orgId' in body) ? await checkOrgForRole(role, 'orgId' in body ? body.orgId : target.org_id) : target.org_id;

  const user = await one(
    `UPDATE users SET full_name = COALESCE($2, full_name), phone = CASE WHEN $3::boolean THEN $4 ELSE phone END,
       role = $5, org_id = $6, is_active = COALESCE($7, is_active) WHERE id = $1 RETURNING *`,
    [id, body.fullName ?? null, 'phone' in body, body.phone ?? null, role, ROLE_ORG_KIND[role] ? orgId : null, body.isActive ?? null]
  );
  // Role or access changed: end their sessions so new permissions apply now
  if (body.role || body.isActive === false || 'orgId' in body) await revokeAllSessions(id);
  await audit(req, 'user.update', 'user', id, body);
  res.json({ user: publicUser(user) });
}));

router.post('/users/:id/reset-link', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const target = await one('SELECT * FROM users WHERE id = $1', [id]);
  if (!target) throw notFound('User not found');
  assertCanManageRole(req.user, target.role);
  const link = await createResetLink(id);
  await audit(req, 'user.reset_link', 'user', id);
  res.json({ link, expiresInMinutes: 60 });
}));

router.get('/audit', requireRole('admin'), ah(async (_req, res) => {
  const rows = await many(
    `SELECT a.*, u.full_name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 200`
  );
  res.json({ entries: rows.map((a) => ({ id: a.id, action: a.action, entity: a.entity, entityId: a.entity_id, actorName: a.actor_name, ip: a.ip, meta: a.meta, at: a.created_at })) });
}));

router.get('/config', (_req, res) => res.json({ emailEnabled: !!config.resendApiKey }));

export default router;
