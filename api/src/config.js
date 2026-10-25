// All runtime settings come from environment variables.
// In production we refuse to start with weak or missing secrets.

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function required(name, fallbackForDev) {
  const value = env[name];
  if (value) return value;
  if (!isProd && fallbackForDev !== undefined) return fallbackForDev;
  throw new Error(`Missing required environment variable: ${name}`);
}

function list(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export const config = {
  isProd,
  port: Number(env.PORT || 4000),
  databaseUrl: required('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/bioloop'),
  databaseSsl: env.DATABASE_SSL ? env.DATABASE_SSL === 'true' : isProd,

  jwtSecret: required('JWT_SECRET', 'dev-only-secret-change-me-dev-only-secret-change-me'),
  accessTokenTtl: env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenDays: Number(env.REFRESH_TOKEN_DAYS || 30),

  // Frontend origins allowed to call the API directly (comma separated).
  corsOrigins: list(env.CORS_ORIGINS || 'http://localhost:5173'),
  // Public URL of the web app, used in password reset links.
  appUrl: (env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
  // "true" when the web app talks to the API on a different site (no Vercel proxy).
  crossSiteCookies: env.CROSS_SITE_COOKIES === 'true',
  // Number of proxies in front of the app (Render = 1, Render behind Vercel rewrite = 2).
  trustProxy: Number(env.TRUST_PROXY || 1),

  // First admin account, created on boot if no admin exists yet.
  adminEmail: env.ADMIN_EMAIL,
  adminPassword: env.ADMIN_PASSWORD,
  adminName: env.ADMIN_NAME || 'BioLoop Admin',
  seedDemo: env.SEED_DEMO === 'true',

  // Optional email for password resets (https://resend.com)
  resendApiKey: env.RESEND_API_KEY,
  mailFrom: env.MAIL_FROM || 'BioLoop <onboarding@resend.dev>',

  // Device behaviour
  offlineAfterMultiplier: Number(env.OFFLINE_AFTER_MULTIPLIER || 3),
  lowBatteryPct: Number(env.LOW_BATTERY_PCT || 20),
  readingRetentionDays: Number(env.READING_RETENTION_DAYS || 180),
};

if (isProd && config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}
