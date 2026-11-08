import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { jwtSecret } from '../config.js';
export async function auth(req, res, next) {
  let token;
  for (const part of (req.get('Cookie') || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0 || part.slice(0, at).trim() !== 'labhub_session') continue;
    try { token = decodeURIComponent(part.slice(at + 1).trim()); }
    catch { return res.status(401).json({ message: '로그인이 만료되었습니다.' }); }
    break;
  }
  if (!token) return res.status(401).json({ message: '로그인이 필요합니다.' });
  let decoded;
  try {
    decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ message: '로그인이 만료되었습니다.' });
  }
  if (decoded.scope !== 'session') return res.status(401).json({ message: '로그인이 만료되었습니다.' });
  const user = await User.findById(decoded.id);
  if (!user || !user.isActive || user.tokenVersion !== decoded.tokenVersion)
    return res.status(401).json({ message: '다시 로그인해주세요.' });
  req.user = { id: String(user._id), name: user.name, email: user.email, role: user.role };
  next();
}

export function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-LabHub-Request') !== '1') return res.status(403).json({ message: '요청 확인 헤더가 필요합니다.' });
  next();
}
export function adminOnly(req, res, next) {
  if (req.user.role !== 'admin')
    return res.status(403).json({ message: '관리자 권한이 필요합니다.' });
  next();
}
export function writer(req, res, next) {
  if (req.user.role === 'viewer')
    return res.status(403).json({ message: '읽기 전용 계정은 수정할 수 없습니다.' });
  next();
}
