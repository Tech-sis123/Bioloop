import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import crypto from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';
import { pool } from './db.js';
import { HttpError } from './lib/errors.js';
import { apiLimiter } from './middleware/rateLimit.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import stationRoutes from './routes/stations.js';
import deviceRoutes from './routes/device.js';
import pickupRoutes from './routes/pickups.js';
import notificationRoutes from './routes/notifications.js';
import reportRoutes from './routes/reports.js';
import batchRoutes from './routes/batches.js';
import adminRoutes from './routes/admin.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = req.headers['x-request-id'] || crypto.randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // Never log credentials
    redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-device-key"]', 'res.headers["set-cookie"]'],
    autoLogging: { ignore: (req) => req.url === '/health' },
  }));

  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  // CORS_ORIGINS="*" lets any website call the API. Cookies/credentials are
  // still only allowed for origins listed by name, so a random site can never
  // ride on a signed-in user's session.
  const allowAll = config.corsOrigins.includes('*');
  const named = config.corsOrigins.filter((o) => o !== '*');
  const corsBase = {
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Device-Key', 'X-Request-Id'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  };
  app.use(cors((req, cb) => {
    const origin = (req.get('origin') || '').replace(/\/$/, '');
    // Devices and server-to-server calls have no Origin header
    if (!origin) return cb(null, { ...corsBase, origin: false });
    if (named.includes(origin)) return cb(null, { ...corsBase, origin: true, credentials: true });
    if (allowAll) return cb(null, { ...corsBase, origin: true, credentials: false });
    return cb(null, { ...corsBase, origin: false });
  }));

  app.use(compression());
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());

  app.get('/', (_req, res) => res.json({ name: 'BioLoop API', docs: 'See docs/IOT_INTEGRATION.md in the repo', health: '/health' }));
  app.get(['/health', '/api/v1/health'], async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, db: 'up', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  const v1 = express.Router();
  // Device traffic has its own limiter (per key) inside the device router
  v1.use('/device', deviceRoutes);
  v1.use(apiLimiter);
  v1.use('/auth', authRoutes);
  v1.use('/me', meRoutes);
  v1.use('/stations', stationRoutes);
  v1.use('/pickups', pickupRoutes);
  v1.use('/notifications', notificationRoutes);
  v1.use('/reports', reportRoutes);
  v1.use('/batches', batchRoutes);
  v1.use('/admin', adminRoutes);
  app.use('/api/v1', v1);

  app.use((_req, _res, next) => next(new HttpError(404, 'Route not found', 'not_found')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Body must be valid JSON', 'bad_json');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'Request body is too large', 'too_large');
    const status = err.status || 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    res.status(status).json({
      error: {
        code: err.code || 'server_error',
        message: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message,
        ...(err.details ? { fields: err.details } : {}),
        requestId: req.id,
      },
    });
  });

  return app;
}
