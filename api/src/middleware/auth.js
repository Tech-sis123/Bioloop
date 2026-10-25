import { one } from '../db.js';
import { verifyAccessToken } from '../lib/auth.js';
import { forbidden, unauthorized } from '../lib/errors.js';

// Verifies the Bearer access token and loads the current user from the DB,
// so deactivated users and revoked sessions are blocked immediately.
export async function requireAuth(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();
    let claims;
    try {
      claims = verifyAccessToken(token);
    } catch {
      throw unauthorized('Your session has expired');
    }
    const user = await one(
      `SELECT u.*, o.name AS org_name FROM users u LEFT JOIN organizations o ON o.id = u.org_id WHERE u.id = $1`,
      [claims.sub]
    );
    if (!user || !user.is_active || user.token_version !== claims.tv) throw unauthorized('Your session has ended');
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

export const isStaff = (user) => user && (user.role === 'agency' || user.role === 'admin');

// Cookie-based endpoints need a custom header. Browsers cannot send custom
// headers cross-site without a CORS preflight, which blocks CSRF.
export function requireCsrfHeader(req, _res, next) {
  if (req.get('x-requested-with') !== 'bioloop') return next(forbidden('Missing request header'));
  next();
}
