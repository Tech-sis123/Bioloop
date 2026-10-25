import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { one, query, tx } from '../db.js';
import { ah, badRequest, conflict, unauthorized } from '../lib/errors.js';
import { parse, email, password, phone, name } from '../lib/validate.js';
import {
  REFRESH_COOKIE, burnTime, checkPassword, cookieOptions, hashPassword, issueRefreshToken,
  publicUser, revokeAllSessions, revokeRefreshToken, rotateRefreshToken, signAccessToken,
} from '../lib/auth.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';
import { sendMail } from '../lib/mail.js';
import { requireAuth, requireCsrfHeader } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';

const router = Router();

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

async function startSession(req, res, user) {
  const rt = await tx((db) => issueRefreshToken(db, user.id, null, req));
  res.cookie(REFRESH_COOKIE, rt.token, cookieOptions());
  const full = await one('SELECT u.*, o.name AS org_name FROM users u LEFT JOIN organizations o ON o.id = u.org_id WHERE u.id = $1', [user.id]);
  return { accessToken: signAccessToken(full), user: publicUser(full) };
}

// Public sign up creates resident accounts only. Staff, collector and recycler
// accounts are created by an agency admin, so nobody can give themselves a role.
router.post('/register', authLimiter, ah(async (req, res) => {
  const body = parse(z.object({
    fullName: name,
    email,
    phone,
    password,
    stationCode: z.string().trim().max(32).optional().or(z.literal('')),
  }), req.body);

  let stationId = null;
  if (body.stationCode) {
    const st = await one('SELECT id FROM stations WHERE upper(code) = upper($1) AND status <> \'retired\'', [body.stationCode]);
    if (!st) throw badRequest('Some fields need attention', { stationCode: 'No station with that code' });
    stationId = st.id;
  }
  const exists = await one('SELECT 1 FROM users WHERE email = $1', [body.email]);
  if (exists) throw conflict('An account with this email already exists. Try signing in.');

  const hash = await hashPassword(body.password);
  const user = await one(
    `INSERT INTO users(email, phone, full_name, password_hash, role, home_station_id, last_login_at)
     VALUES ($1,$2,$3,$4,'resident',$5, now()) RETURNING *`,
    [body.email, body.phone || null, body.fullName, hash, stationId]
  );
  req.user = user;
  await audit(req, 'auth.register', 'user', user.id);
  res.status(201).json(await startSession(req, res, user));
}));

router.post('/login', authLimiter, ah(async (req, res) => {
  const body = parse(z.object({ email, password: z.string().min(1).max(128) }), req.body);
  const user = await one('SELECT * FROM users WHERE email = $1', [body.email]);
  const generic = 'Email or password is incorrect';

  if (!user) {
    await burnTime(body.password);
    throw unauthorized(generic);
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw unauthorized(`Too many failed attempts. Try again after ${new Date(user.locked_until).toLocaleTimeString('en-US', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit' })}.`);
  }
  const ok = await checkPassword(body.password, user.password_hash);
  if (!ok) {
    const failed = user.failed_logins + 1;
    const lock = failed >= MAX_FAILED;
    await query(
      `UPDATE users SET failed_logins = $2, locked_until = CASE WHEN $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END WHERE id = $1`,
      [user.id, lock ? 0 : failed, lock, String(LOCK_MINUTES)]
    );
    await audit(req, lock ? 'auth.locked' : 'auth.login_failed', 'user', user.id, null, user.id);
    throw unauthorized(generic);
  }
  if (!user.is_active) throw unauthorized('This account has been deactivated. Contact your BioLoop admin.');

  await query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
  req.user = user;
  await audit(req, 'auth.login', 'user', user.id);
  res.json(await startSession(req, res, user));
}));

router.post('/refresh', requireCsrfHeader, ah(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw unauthorized('No session');
  const result = await rotateRefreshToken(token, req);
  if (result.error) {
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
    if (result.error === 'reused') await audit(req, 'auth.refresh_reuse', 'user', result.userId, null, result.userId);
    throw unauthorized('Your session has ended. Please sign in again.');
  }
  res.cookie(REFRESH_COOKIE, result.token, cookieOptions());
  const full = await one('SELECT u.*, o.name AS org_name FROM users u LEFT JOIN organizations o ON o.id = u.org_id WHERE u.id = $1', [result.user.id]);
  res.json({ accessToken: signAccessToken(full), user: publicUser(full) });
}));

router.post('/logout', requireCsrfHeader, ah(async (req, res) => {
  await revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
}));

router.post('/logout-all', requireAuth, ah(async (req, res) => {
  await revokeAllSessions(req.user.id);
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
  await audit(req, 'auth.logout_all', 'user', req.user.id);
  res.json({ ok: true });
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.post('/change-password', requireAuth, ah(async (req, res) => {
  const body = parse(z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }), req.body);
  const ok = await checkPassword(body.currentPassword, req.user.password_hash);
  if (!ok) throw badRequest('Some fields need attention', { currentPassword: 'Current password is incorrect' });
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await hashPassword(body.newPassword)]);
  await revokeAllSessions(req.user.id);
  await audit(req, 'auth.password_changed', 'user', req.user.id);
  const user = await one('SELECT * FROM users WHERE id = $1', [req.user.id]);
  res.json(await startSession(req, res, user));
}));

// Always answers the same way so it cannot be used to discover which emails exist.
router.post('/forgot-password', authLimiter, ah(async (req, res) => {
  const body = parse(z.object({ email }), req.body);
  const user = await one('SELECT id, full_name, email, is_active FROM users WHERE email = $1', [body.email]);
  if (user && user.is_active) {
    const link = await createResetLink(user.id);
    await sendMail({
      to: user.email,
      subject: 'Reset your BioLoop password',
      text: `Hi ${user.full_name},\n\nUse this link to set a new BioLoop password. It expires in 1 hour.\n\n${link}\n\nIf you did not ask for this, ignore this email.`,
    }).catch((err) => req.log.warn({ err }, 'reset email failed'));
    await audit(req, 'auth.reset_requested', 'user', user.id, null, user.id);
  }
  res.json({ ok: true, message: 'If that email has an account, a reset link is on its way.' });
}));

router.post('/reset-password', authLimiter, ah(async (req, res) => {
  const body = parse(z.object({ token: z.string().min(20).max(200), password }), req.body);
  const row = await one(
    `UPDATE password_resets SET used_at = now()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
    [sha256(body.token)]
  );
  if (!row) throw badRequest('This reset link is invalid or has expired. Ask for a new one.');
  await query('UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1', [row.user_id, await hashPassword(body.password)]);
  await revokeAllSessions(row.user_id);
  await audit(req, 'auth.password_reset', 'user', row.user_id, null, row.user_id);
  res.json({ ok: true });
}));

export async function createResetLink(userId) {
  const token = randomToken(32);
  await query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  await query(`INSERT INTO password_resets(user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '1 hour')`, [userId, sha256(token)]);
  return `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

export default router;
