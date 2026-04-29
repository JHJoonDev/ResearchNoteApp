import jwt from 'jsonwebtoken';

export const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '인증 토큰이 제공되지 않았습니다.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_key');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
  }
};

export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: '시스템 접근 권한이 없습니다.' });
    }
    next();
  };
};

export const requireElnRole = (elnRoles) => {
  return (req, res, next) => {
    if (!req.user || !elnRoles.includes(req.user.elnRole)) {
      return res.status(403).json({ success: false, message: 'ELN 접근 권한이 없습니다.' });
    }
    next();
  };
};
