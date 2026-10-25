import rateLimit from 'express-rate-limit';

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many requests. Please slow down and try again shortly.' } },
};

// General API traffic per IP
export const apiLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 300 });

// Login / register / reset: tight, per IP
export const authLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 30 });

// Devices: keyed by device key prefix rather than IP, since many SIM devices share carrier IPs
export const deviceLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: 30,
  keyGenerator: (req) => {
    const h = req.get('authorization') || '';
    const m = /blk_([a-f0-9]{8})_/.exec(h);
    return m ? `dev:${m[1]}` : `ip:${req.ip}`;
  },
});
