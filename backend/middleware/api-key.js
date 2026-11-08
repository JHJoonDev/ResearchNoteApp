import crypto from 'node:crypto';
import ApiKey from '../models/ApiKey.js';
import User from '../models/User.js';

export async function apiKeyAuth(req, res, next) {
  const authorization = req.get('Authorization') || '';
  const match = /^Bearer (lh_([a-f\d]{12})_([A-Za-z0-9_-]{40,}))$/.exec(authorization);
  const cookie = (req.get('Cookie') || '').split(';').some((part) => part.trim().startsWith('labhub_session='));
  if (!match || cookie) return res.status(401).json({ message: '유효한 API 키 인증이 필요합니다.' });
  try {
    const key = await ApiKey.findOne({ prefix: match[2] });
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date())) return res.status(401).json({ message: '유효한 API 키 인증이 필요합니다.' });
    const received = crypto.createHash('sha256').update(match[1]).digest();
    const stored = Buffer.from(key.hash, 'hex');
    if (stored.length !== received.length || !crypto.timingSafeEqual(stored, received)) return res.status(401).json({ message: '유효한 API 키 인증이 필요합니다.' });
    const user = await User.findOne({ _id: key.userId, isActive: true });
    if (!user) return res.status(401).json({ message: '유효한 API 키 인증이 필요합니다.' });
    req.user = { id: String(user._id), name: user.name, email: user.email, role: user.role };
    req.apiKey = { id: String(key._id), scopes: key.scopes || [] };
    void ApiKey.updateOne({ _id: key._id, revokedAt: null }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
    next();
  } catch (error) { next(error); }
}

export function requireScope(scope) {
  return (req, res, next) => {
    if (!req.apiKey?.scopes?.includes(scope)) return res.status(403).json({ message: '이 API 키에 필요한 권한이 없습니다.' });
    if (scope === 'inbox:write' && req.user.role === 'viewer') return res.status(403).json({ message: '읽기 전용 계정은 파일을 올릴 수 없습니다.' });
    next();
  };
}

const buckets = new Map();
export function perKeyRateLimit(req, res, next) {
  const now = Date.now(), limit = Number(process.env.API_KEY_RATE_LIMIT || 120), windowMs = 60_000;
  for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key);
  const id = req.apiKey.id, bucket = buckets.get(id);
  if (bucket && bucket.count >= limit) return res.status(429).set('Retry-After', String(Math.ceil((bucket.until - now) / 1000))).json({ message: 'API 키 요청 한도를 초과했습니다.' });
  if (bucket) bucket.count++; else buckets.set(id, { count: 1, until: now + windowMs });
  next();
}
