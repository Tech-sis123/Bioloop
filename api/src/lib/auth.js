import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one, query, tx } from '../db.js';
import { randomToken, sha256 } from './crypto.js';

export const REFRESH_COOKIE = 'bl_rt';
const BCRYPT_ROUNDS = 12;

export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const checkPassword = (plain, hash) => bcrypt.compare(plain, hash);

// A real hash of a random string, used so failed logins for unknown emails take
// the same time as wrong passwords (stops email enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync(randomToken(12), BCRYPT_ROUNDS);
export const burnTime = (plain) => bcrypt.compare(plain, DUMMY_HASH);

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, tv: user.token_version },
    config.jwtSecret,
    { expiresIn: config.accessTokenTtl, issuer: 'bioloop', audience: 'bioloop-web', algorithm: 'HS256' }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtSecret, {
    issuer: 'bioloop',
    audience: 'bioloop-web',
    algorithms: ['HS256'],
  });
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProd || config.crossSiteCookies,
    sameSite: config.crossSiteCookies ? 'none' : 'lax',
    path: '/api/v1/auth',
    maxAge: config.refreshTokenDays * 24 * 3600 * 1000,
  };
}

// Create a refresh token. familyId links all rotations of one login session.
export async function issueRefreshToken(db, userId, familyId, req) {
  const token = randomToken(48);
  const row = await db.one(
    `INSERT INTO refresh_tokens(user_id, family_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, COALESCE($2, gen_random_uuid()), $3, now() + ($4 || ' days')::interval, $5, $6)
     RETURNING id, family_id`,
    [userId, familyId, sha256(token), String(config.refreshTokenDays), (req.get('user-agent') || '').slice(0, 200), req.ip]
  );
  return { token, id: row.id, familyId: row.family_id };
}

// Rotate a refresh token. If an already-used token is replayed, the whole
// session family is revoked (someone stole it).
export async function rotateRefreshToken(token, req) {
  return tx(async (db) => {
    const row = await db.one(
      `SELECT rt.*, u.is_active FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 FOR UPDATE OF rt`,
      [sha256(token)]
    );
    if (!row) return { error: 'invalid' };
    if (row.revoked_at) {
      await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id]);
      return { error: 'reused', userId: row.user_id };
    }
    if (new Date(row.expires_at) < new Date() || !row.is_active) return { error: 'expired' };
    const next = await issueRefreshToken(db, row.user_id, row.family_id, req);
    await db.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1', [row.id, next.id]);
    const user = await db.one('SELECT * FROM users WHERE id = $1', [row.user_id]);
    return { user, token: next.token };
  });
}

export async function revokeRefreshToken(token) {
  if (!token) return;
  const row = await one('SELECT family_id FROM refresh_tokens WHERE token_hash = $1', [sha256(token)]);
  if (row) await query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id]);
}

export async function revokeAllSessions(userId) {
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
  await query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
}

// Public shape of a user. Never includes hashes or security counters.
export function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    phone: u.phone,
    fullName: u.full_name,
    role: u.role,
    orgId: u.org_id,
    orgName: u.org_name ?? undefined,
    homeStationId: u.home_station_id,
    points: u.points,
    isActive: u.is_active,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}
