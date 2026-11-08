import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import path from 'node:path';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { root } from './config.js';
import { csrf } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import elnRoutes from './routes/eln.js';
import limsRoutes from './routes/lims.js';
import membersRoutes from './routes/members.js';
import auditRoutes from './routes/audit.js';
import projectsRoutes from './routes/projects.js';
import filesRoutes from './routes/files.js';
import templatesRoutes from './routes/templates.js';
import publicRoutes from './routes/public.js';
import collaborationRoutes from './routes/collaboration.js';
import experimentRoutes from './routes/experiments.js';
import protocolRoutes from './routes/protocols.js';
import searchRoutes from './routes/search.js';
import locationsRoutes from './routes/locations.js';
import entitiesRoutes from './routes/entities.js';
import labelsRoutes from './routes/labels.js';
import scanRoutes from './routes/scan.js';
import apiKeyRoutes from './routes/api-keys.js';
import webhooksRoutes from './routes/webhooks.js';
import aiRoutes from './routes/ai.js';
import { apiV1Router, inboxRouterForSession } from './routes/api-v1.js';
import { health as storageHealth } from './lib/storage/index.js';
import { prometheusText, recordRequest } from './lib/metrics.js';
export const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  const requestId = req.get('X-Request-Id')?.slice(0, 100) || crypto.randomUUID();
  res.set('X-Request-Id', requestId);
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    recordRequest(req.method, res.statusCode);
    console.log(JSON.stringify({ level: 'info', event: 'http_request', requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(durationMs * 100) / 100 }));
  });
  next();
});
app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'data:', 'blob:'] } } }));
export function parseTrustProxyHops(value = process.env.TRUST_PROXY) {
  if (value === undefined || value.trim() === '') return undefined;
  if (!/^\d+$/.test(value.trim())) throw new Error('TRUST_PROXY는 0 이상의 정수 홉 수여야 합니다.');
  const hops = Number(value);
  if (!Number.isSafeInteger(hops)) throw new Error('TRUST_PROXY는 0 이상의 정수 홉 수여야 합니다.');
  return hops;
}
const trustProxyHops = parseTrustProxyHops();
if (trustProxyHops !== undefined) app.set('trust proxy', trustProxyHops);
const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((x) => x.trim());
app.use(cors({ origin: (origin, callback) => callback(null, !origin || origins.includes(origin)), credentials: true }));
app.use('/api/eln', express.json({ limit: '8mb' }));
app.use(express.json({ limit: '4mb' }));
app.use((req, res, next) => {
  req.body ??= {};
  next();
});
app.use('/api/v1', apiV1Router);
app.use('/api', csrf);
app.use('/api', collaborationRoutes);
app.use(
  '/api/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: process.env.NODE_ENV === 'test' ? 1000 : 100,
    message: { message: '로그인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/health/ready', async (_req, res) => {
  if (mongoose.connection.readyState !== 1) return res.status(503).json({ status: 'unavailable', database: false, storage: false });
  try { await storageHealth(); return res.json({ status: 'ok', database: true, storage: true }); }
  catch { return res.status(503).json({ status: 'unavailable', database: true, storage: false }); }
});
app.get('/api/metrics', (req, res) => {
  const token = process.env.METRICS_TOKEN;
  if (!token) return res.status(404).end();
  const received = req.get('X-Metrics-Token') || '';
  const a = Buffer.from(received), b = Buffer.from(token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).end();
  res.type('text/plain; version=0.0.4; charset=utf-8').send(prometheusText());
});
app.use('/api/auth', authRoutes);
app.use('/api/eln', elnRoutes);
app.use('/api/lims', limsRoutes);
app.use('/api/members', membersRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api', entitiesRoutes);
app.use('/api/labels', labelsRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/api-keys', apiKeyRoutes);
app.use('/api/inbox', inboxRouterForSession);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api', experimentRoutes);
app.use('/api', protocolRoutes);
app.use('/api', searchRoutes);
const frontendDir = path.resolve(root, '../frontend/dist');
if (existsSync(path.join(frontendDir, 'index.html'))) {
  app.use(express.static(frontendDir));
  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
    res.set('Cache-Control', 'no-cache').sendFile(path.join(frontendDir, 'index.html'));
  });
}
app.use((req, res) => res.status(404).json({ message: '요청한 경로가 없습니다.' }));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status =
    err.code === 11000
      ? 409
      : err.code === 'LIMIT_FILE_SIZE'
        ? 413
        : ['ValidationError', 'CastError', 'MulterError'].includes(err.name)
          ? 400
          : err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({
    message:
      err.code === 11000
        ? '이미 등록된 정보입니다.'
        : status === 500
          ? '서버 오류가 발생했습니다. 다시 시도해주세요.'
          : err.message,
    ...(status !== 500 && err.details ? err.details : {}),
  });
});
