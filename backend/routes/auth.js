import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import User from '../models/User.js';
import UserSigningKey from '../models/UserSigningKey.js';
import MfaLoginChallenge from '../models/MfaLoginChallenge.js';
import { auth } from '../middleware/auth.js';
import { jwtSecret } from '../config.js';
import { fail, text } from '../lib/core.js';
import { appendAudit } from '../lib/audit.js';
import { createSigningKey, decryptSecret, encryptSecret, randomToken, verifyTotp, reencryptSigningKey, digest } from '../lib/crypto.js';
import AccountToken from '../models/AccountToken.js';
import OidcLoginState from '../models/OidcLoginState.js';
import * as oidc from 'openid-client';
import { mailConfigured, sendMail } from '../lib/mail/index.js';
import { runBackground } from '../lib/background.js';

const router = express.Router();
const resetRequestBuckets = new Map();
const RESET_WINDOW_MS = 15 * 60 * 1000;
function resetRequestAllowed(address) {
  const now = Date.now();
  for (const [key, entry] of resetRequestBuckets) if (entry.until <= now) resetRequestBuckets.delete(key);
  const entry = resetRequestBuckets.get(address);
  if (entry && entry.count >= 5) return false;
  if (!entry) resetRequestBuckets.set(address, { count: 1, until: now + RESET_WINDOW_MS });
  else entry.count += 1;
  return true;
}
const DUMMY_PASSWORD_HASH = '$2b$12$q4VlnO3fe2QVuCAv7DgHreXBrKY.xUTD1wiKQkDpTiLHOQzxvi9jC';
const cookieOptions = () => ({ httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 12 * 60 * 60 * 1000 });
const userView = (user) => ({ id: String(user._id), name: user.name, email: user.email, role: user.role });
function issueToken(user) {
  return jwt.sign({ id: String(user._id), tokenVersion: user.tokenVersion, scope: 'session' }, jwtSecret, { algorithm: 'HS256', expiresIn: '12h' });
}
function setSessionCookie(res, user) { res.cookie('labhub_session', issueToken(user), cookieOptions()); }
const oidcCookieOptions = () => ({ httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/auth/oidc', maxAge: 10 * 60 * 1000 });
let oidcConfiguration, oidcConfigKey;
function oidcEnabled() { return Boolean(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET && process.env.OIDC_REDIRECT_URI); }
async function getOidcConfiguration() {
  if (!oidcEnabled()) fail(404, '기관 계정 로그인이 설정되지 않았습니다.');
  const key = `${process.env.OIDC_ISSUER}|${process.env.OIDC_CLIENT_ID}`;
  if (!oidcConfiguration || oidcConfigKey !== key) {
    const issuer = new URL(process.env.OIDC_ISSUER);
    const localTestIssuer = process.env.NODE_ENV === 'test' && issuer.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(issuer.hostname);
    oidcConfiguration = await oidc.discovery(issuer, process.env.OIDC_CLIENT_ID, process.env.OIDC_CLIENT_SECRET, undefined,
      localTestIssuer ? { execute: [oidc.allowInsecureRequests] } : undefined);
    oidcConfigKey = key;
  }
  return oidcConfiguration;
}
function cookieValue(req, name) {
  for (const part of (req.get('Cookie') || '').split(';')) {
    const at = part.indexOf('='); if (at < 0 || part.slice(0, at).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(at + 1).trim()); } catch { return ''; }
  }
  return '';
}
export function password(value) {
  text(value, '비밀번호', 128);
  if (value.length < 12) fail(400, '비밀번호는 12자 이상이어야 합니다.');
  return value;
}
export function email(value) {
  const v = text(value, '이메일', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail(400, '이메일 형식을 확인해주세요.');
  return v;
}
function auditRequest(req, user, action, description, session, targetId) {
  return appendAudit({ userId: user?._id, userName: user?.name || 'System', userEmail: user?.email, action, targetType: 'AUTH', targetId: targetId || (user ? String(user._id) : undefined), description, ipAddress: req.ip, session });
}
async function recordLoginFailure(req, address, user) {
  await mongoose.connection.transaction(async (session) => {
    if (user) {
      const failed = await User.findById(user._id).session(session);
      if (failed && failed.isActive) {
        failed.loginFailures = (failed.loginFailures || 0) + 1;
        if (failed.loginFailures >= 5) failed.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        await failed.save({ session });
      }
    }
    const targetId = user ? String(user._id) : crypto.createHash('sha256').update(address).digest('hex');
    await auditRequest(req, user, 'LOGIN_FAILED', '로그인 실패', session, targetId);
  });
}
async function checkMfaCode(user, code, session) {
  if (typeof code !== 'string') return false;
  if (!user.mfaEnabled) return true;
  if (user.mfaSecretEncrypted) {
    const secret = await decryptSecret(user.mfaSecretEncrypted);
    if (verifyTotp(secret, code)) return true;
  }
  const hash = digest(code || '');
  const index = (user.recoveryCodeHashes || []).indexOf(hash);
  if (index < 0) return false;
  user.recoveryCodeHashes.splice(index, 1);
  await user.save({ session });
  return true;
}

router.get('/setup', async (req, res) => res.json({ required: (await User.countDocuments()) === 0 }));
router.post('/setup', async (req, res) => {
  if (process.env.NODE_ENV === 'production' && (!process.env.SETUP_TOKEN || req.get('X-Setup-Token') !== process.env.SETUP_TOKEN))
    fail(403, '관리자가 지정한 최초 설정 코드가 필요합니다.');
  const fields = {
    name: text(req.body.name, '이름'), email: email(req.body.email),
    password: await bcrypt.hash(password(req.body.password), 12), role: 'admin',
  };
  await mongoose.connection.transaction(async (session) => {
    if (await User.countDocuments().session(session)) fail(409, '최초 설정이 이미 완료되었습니다.');
    await mongoose.connection.collection('setup').insertOne({ _id: 'initial-admin' }, { session });
    await mongoose.connection.collection('setup').insertOne({ _id: 'admin-membership', revision: 0 }, { session });
    const [user] = await User.create([fields], { session });
    await appendAudit({ userId: user._id, userName: user.name, userEmail: user.email, action: 'SETUP', targetType: 'AUTH', targetId: String(user._id), description: '최초 관리자 설정', session, ipAddress: req.ip });
  });
  res.status(201).json({ success: true });
});

router.post('/login', async (req, res) => {
  const address = email(req.body.email);
  const loginPassword = text(req.body.password, '비밀번호', 128);
  const user = await User.findOne({ email: address });
  const usableUser = user && user.isActive && (!user.lockedUntil || user.lockedUntil <= new Date()) ? user : null;
  const passwordMatches = await bcrypt.compare(loginPassword, usableUser?.password || DUMMY_PASSWORD_HASH);
  const valid = Boolean(usableUser && !usableUser.oidcIssuer && !usableUser.ssoOnly && passwordMatches);
  if (!valid) {
    await recordLoginFailure(req, address, user);
    fail(401, '이메일 또는 비밀번호가 잘못되었습니다.');
  }
  if (user.mfaEnabled) {
    const mfaToken = jwt.sign({ id: String(user._id), tokenVersion: user.tokenVersion, scope: 'mfa' }, jwtSecret, { algorithm: 'HS256', expiresIn: '5m', jwtid: crypto.randomUUID() });
    const decoded = jwt.verify(mfaToken, jwtSecret);
    await mongoose.connection.transaction(async (session) => {
      await MfaLoginChallenge.create([{ tokenHash: digest(decoded.jti), userId: user._id, expiresAt: new Date(Date.now() + 5 * 60 * 1000) }], { session });
      await auditRequest(req, user, 'LOGIN_MFA_PENDING', 'MFA 확인 대기', session);
    });
    return res.json({ mfaRequired: true, mfaToken });
  }
  await mongoose.connection.transaction(async (session) => {
    user.loginFailures = 0;
    user.lockedUntil = undefined;
    await user.save({ session });
    await auditRequest(req, user, 'LOGIN', '로그인 성공', session);
  });
  setSessionCookie(res, user);
  res.json({ success: true, user: userView(user) });
});

router.post('/login/mfa', async (req, res) => {
  let decoded;
  try { decoded = jwt.verify(text(req.body.mfaToken, 'MFA 토큰', 4096), jwtSecret, { algorithms: ['HS256'] }); }
  catch { fail(401, '인증 요청이 만료되었습니다. 다시 로그인해주세요.'); }
  if (decoded.scope !== 'mfa' || !decoded.jti) fail(401, '인증 요청이 올바르지 않습니다.');
  const user = await User.findOne({ _id: decoded.id, isActive: true, tokenVersion: decoded.tokenVersion });
  if (!user || !user.mfaEnabled || (user.lockedUntil && user.lockedUntil > new Date())) fail(401, '인증 요청이 만료되었습니다. 다시 로그인해주세요.');
  let accepted = false;
  await mongoose.connection.transaction(async (session) => {
    const challenge = await MfaLoginChallenge.findOne({ tokenHash: digest(decoded.jti), userId: user._id, usedAt: { $exists: false }, expiresAt: { $gt: new Date() } }).session(session);
    if (!challenge) fail(401, '인증 요청이 만료되었거나 이미 사용되었습니다.');
    const current = await User.findOne({ _id: user._id, isActive: true }).session(session);
    accepted = await checkMfaCode(current, req.body.code, session);
    if (!accepted) {
      current.loginFailures = (current.loginFailures || 0) + 1;
      if (current.loginFailures >= 5) current.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      await current.save({ session });
      await auditRequest(req, current, 'LOGIN_FAILED', 'MFA 인증 실패', session);
      return;
    }
    challenge.usedAt = new Date();
    await challenge.save({ session });
    current.loginFailures = 0;
    current.lockedUntil = undefined;
    await current.save({ session });
    await auditRequest(req, current, 'LOGIN', 'MFA 로그인 성공', session);
    user.tokenVersion = current.tokenVersion;
  });
  if (!accepted) fail(401, '인증 코드가 올바르지 않습니다.');
  setSessionCookie(res, user);
  res.json({ success: true, user: userView(user) });
});

router.get('/me', auth, (req, res) => res.json({ success: true, user: req.user }));
router.post('/logout', auth, async (req, res) => {
  await mongoose.connection.transaction(async (session) => {
    const user = await User.findByIdAndUpdate(req.user.id, { $inc: { tokenVersion: 1 } }, { returnDocument: 'after', session });
    await auditRequest(req, user, 'LOGOUT', '로그아웃', session);
  });
  res.clearCookie('labhub_session', cookieOptions());
  res.json({ success: true });
});

router.post('/password-reset/request', async (req, res) => {
  const address = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
  const allowed = resetRequestAllowed(req.ip || 'unknown');
  await bcrypt.compare('constant-timing-work', DUMMY_PASSWORD_HASH);
  if (allowed && address) {
    res.once('finish', () => runBackground(async () => {
      const user = await User.findOne({ email: address });
      if (!user?.isActive) return;
      const token = randomToken();
      const tokenHash = digest(token);
      await mongoose.connection.transaction(async (session) => {
        await AccountToken.updateMany({ userId: user._id, purpose: 'password-reset', usedAt: { $exists: false } }, { $set: { usedAt: new Date() } }, { session });
        await AccountToken.create([{ userId: user._id, tokenHash, purpose: 'password-reset', expiresAt: new Date(Date.now() + 30 * 60 * 1000) }], { session });
        await auditRequest(req, user, 'PASSWORD_RESET_REQUEST', '비밀번호 재설정을 요청했습니다.', session);
      });
      if (mailConfigured()) {
        const url = `${publicBaseUrl()}/reset-password#${token}`;
        await sendMail({ to: user.email, subject: 'LabHub 비밀번호 재설정', text: `30분 안에 다음 일회용 링크를 사용하세요: ${url}` });
      }
    }, '비밀번호 재설정 처리 실패'));
  }
  res.status(200).json({ message: '계정이 활성 상태이면 비밀번호 재설정 안내를 보냈습니다.' });
});

router.post('/password-reset/confirm', async (req, res) => {
  const token = text(req.body.token, '재설정 토큰', 256);
  const nextPassword = password(req.body.newPassword);
  let user;
  await mongoose.connection.transaction(async (session) => {
    const record = await AccountToken.findOne({ tokenHash: digest(token), purpose: 'password-reset', usedAt: { $exists: false }, expiresAt: { $gt: new Date() } }).session(session);
    if (!record) fail(400, '재설정 링크가 유효하지 않거나 만료되었습니다.');
    record.usedAt = new Date(); await record.save({ session });
    user = await User.findOne({ _id: record.userId, isActive: true }).session(session);
    if (!user) fail(400, '재설정 링크가 유효하지 않거나 만료되었습니다.');
    user.password = await bcrypt.hash(nextPassword, 12);
    user.tokenVersion += 1;
    user.isActive = true;
    await user.save({ session });
    const keys = await UserSigningKey.find({ userId: user._id, active: true }).session(session);
    for (const key of keys) { key.active = false; key.revokedAt = new Date(); key.revokeReason = '비밀번호 재설정'; await key.save({ session }); }
    await auditRequest(req, user, 'PASSWORD_RESET', '비밀번호 재설정을 완료했습니다.', session);
  });
  res.json({ success: true });
});

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || process.env.CORS_ORIGIN?.split(',')[0] || '').replace(/\/$/, '');
}

router.post('/invitation/inspect', async (req, res) => {
  const token = typeof req.body.token === 'string' && req.body.token.length <= 256 ? req.body.token : '';
  const record = token ? await AccountToken.findOne({ tokenHash: digest(token), purpose: 'invite', usedAt: { $exists: false }, expiresAt: { $gt: new Date() } }) : null;
  const user = record ? await User.findOne({ _id: record.userId, isActive: true }).select('name email') : null;
  if (!record || !user) return res.status(400).json({ message: '초대 링크가 유효하지 않거나 만료되었습니다.' });
  res.json({ name: user.name, email: user.email });
});

router.post('/invitation/accept', async (req, res) => {
  const token = typeof req.body.token === 'string' && req.body.token.length <= 256 ? req.body.token : '';
  const nextPassword = password(req.body.newPassword);
  let user;
  await mongoose.connection.transaction(async (session) => {
    const record = token ? await AccountToken.findOne({ tokenHash: digest(token), purpose: 'invite', usedAt: { $exists: false }, expiresAt: { $gt: new Date() } }).session(session) : null;
    if (!record) fail(400, '초대 링크가 유효하지 않거나 만료되었습니다.');
    record.usedAt = new Date(); await record.save({ session });
    user = await User.findOne({ _id: record.userId, isActive: true }).session(session);
    if (!user) fail(400, '초대 링크가 유효하지 않거나 만료되었습니다.');
    user.password = await bcrypt.hash(nextPassword, 12);
    user.tokenVersion += 1;
    await user.save({ session });
    await auditRequest(req, user, 'INVITATION_ACCEPT', '초대를 수락했습니다.', session);
  });
  res.json({ success: true });
});

router.get('/mfa', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('mfaEnabled');
  res.json({ enabled: Boolean(user?.mfaEnabled) });
});
router.post('/mfa/setup', auth, async (req, res) => {
  text(req.body.password, '비밀번호', 128);
  const user = await User.findById(req.user.id);
  if (!(await bcrypt.compare(req.body.password, user.password))) fail(400, '비밀번호가 일치하지 않습니다.');
  if (user.mfaEnabled) fail(409, 'MFA가 이미 설정되어 있습니다.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = crypto.randomBytes(20);
  let bits = 0, value = 0, secret = '';
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { secret += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) secret += alphabet[(value << (5 - bits)) & 31];
  const encrypted = await encryptSecret(secret);
  await mongoose.connection.transaction(async (session) => {
    const current = await User.findById(req.user.id).session(session);
    if (!current || !current.isActive) fail(401, '다시 로그인해주세요.');
    if (!(await bcrypt.compare(req.body.password, current.password))) fail(400, '비밀번호가 일치하지 않습니다.');
    if (current.mfaEnabled) fail(409, 'MFA가 이미 설정되어 있습니다.');
    current.mfaPendingSecretEncrypted = encrypted;
    await current.save({ session });
    await auditRequest(req, current, 'MFA_SETUP', 'MFA 등록 준비', session);
  });
  const label = encodeURIComponent(`${process.env.ORG_NAME || 'LabHub'}:${user.email}`);
  const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(process.env.ORG_NAME || 'LabHub')}&algorithm=SHA1&digits=6&period=30`;
  res.json({ otpauthUrl, secret });
});
router.post('/mfa/enable', auth, async (req, res) => {
  const code = text(req.body.code, '인증 코드', 20);
  let recoveryCodes;
  await mongoose.connection.transaction(async (session) => {
    const user = await User.findById(req.user.id).session(session);
    if (!user?.mfaPendingSecretEncrypted) fail(409, '먼저 MFA 등록을 시작해주세요.');
    const secret = await decryptSecret(user.mfaPendingSecretEncrypted);
    if (!verifyTotp(secret, code)) fail(400, '인증 코드가 올바르지 않습니다.');
    recoveryCodes = Array.from({ length: 10 }, () => randomToken().slice(0, 12).toUpperCase());
    user.mfaSecretEncrypted = user.mfaPendingSecretEncrypted;
    user.mfaPendingSecretEncrypted = undefined;
    user.mfaEnabled = true;
    user.recoveryCodeHashes = recoveryCodes.map(digest);
    await user.save({ session });
    await auditRequest(req, user, 'MFA_ENABLE', 'MFA 설정', session);
  });
  res.json({ recoveryCodes });
});
router.post('/mfa/disable', auth, async (req, res) => {
  text(req.body.password, '비밀번호', 128);
  const code = text(req.body.code, '인증 코드', 128);
  await mongoose.connection.transaction(async (session) => {
    const user = await User.findById(req.user.id).session(session);
    if (!(await bcrypt.compare(req.body.password, user.password))) fail(400, '비밀번호가 일치하지 않습니다.');
    if (!user.mfaEnabled) fail(409, 'MFA가 설정되어 있지 않습니다.');
    const valid = await checkMfaCode(user, code, session);
    if (!valid) fail(400, '인증 코드가 올바르지 않습니다.');
    user.mfaEnabled = false;
    user.mfaSecretEncrypted = undefined;
    user.mfaPendingSecretEncrypted = undefined;
    user.recoveryCodeHashes = [];
    user.tokenVersion += 1;
    await user.save({ session });
    await auditRequest(req, user, 'MFA_DISABLE', 'MFA 해제', session);
  });
  res.clearCookie('labhub_session', cookieOptions());
  res.json({ success: true });
});

router.put('/password', auth, async (req, res) => {
  text(req.body.currentPassword, '현재 비밀번호', 128);
  const user = await User.findById(req.user.id);
  if (!(await bcrypt.compare(req.body.currentPassword, user.password))) fail(400, '현재 비밀번호가 일치하지 않습니다.');
  const nextPassword = password(req.body.newPassword);
  await mongoose.connection.transaction(async (session) => {
    const current = await User.findById(user._id).session(session);
    current.password = await bcrypt.hash(nextPassword, 12);
    current.tokenVersion += 1;
    await current.save({ session });
    const key = await UserSigningKey.findOne({ userId: current._id, active: true }).session(session);
    if (key) { await reencryptSigningKey(key, req.body.currentPassword, nextPassword); await key.save({ session }); }
    await auditRequest(req, current, 'PASSWORD_CHANGE', '비밀번호 변경', session);
  });
  res.clearCookie('labhub_session', cookieOptions());
  res.json({ success: true });
});

router.get('/providers', (_req, res) => res.json({ oidc: { enabled: oidcEnabled(), label: process.env.OIDC_LABEL || '기관 계정' } }));
router.get('/oidc/start', async (req, res) => {
  const configuration = await getOidcConfiguration();
  const state = oidc.randomState(), nonce = oidc.randomNonce(), verifier = oidc.randomPKCECodeVerifier();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  await OidcLoginState.deleteMany({ expiresAt: { $lte: new Date() } });
  await OidcLoginState.create({ state, nonce, verifier, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
  res.cookie('oidc_login_state', state, oidcCookieOptions());
  const url = oidc.buildAuthorizationUrl(configuration, {
    redirect_uri: process.env.OIDC_REDIRECT_URI,
    response_type: 'code', scope: 'openid email profile', state, nonce,
    code_challenge: challenge, code_challenge_method: 'S256',
  });
  res.redirect(302, url.href);
});
router.get('/oidc/callback', async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const cookieState = cookieValue(req, 'oidc_login_state');
  res.clearCookie('oidc_login_state', oidcCookieOptions());
  if (!state || state !== cookieState) fail(400, '기관 로그인 상태 검증에 실패했습니다. 다시 시도해주세요.');
  const stored = await OidcLoginState.findOneAndDelete({ state, expiresAt: { $gt: new Date() } });
  if (!stored) fail(400, '기관 로그인 요청이 만료되었거나 이미 사용되었습니다.');
  if (req.query.error || typeof req.query.code !== 'string') fail(401, '기관 로그인이 취소되었거나 실패했습니다.');
  const configuration = await getOidcConfiguration();
  const callbackUrl = new URL(req.originalUrl, process.env.OIDC_REDIRECT_URI);
  let tokenSet;
  try {
    tokenSet = await oidc.authorizationCodeGrant(configuration, callbackUrl, {
      pkceCodeVerifier: stored.verifier,
      expectedState: stored.state,
      expectedNonce: stored.nonce,
    });
  } catch (error) {
    if (String(error?.code || '').includes('JWT_CLAIM') || String(error?.code || '').includes('ID_TOKEN')) fail(401, '기관 로그인 검증에 실패했습니다. 다시 시도해주세요.');
    fail(502, '기관 인증 서버와 통신할 수 없습니다. 잠시 후 다시 시도해주세요.');
  }
  const claims = tokenSet.claims();
  if (!claims || typeof claims.sub !== 'string' || claims.email_verified !== true || typeof claims.email !== 'string') fail(403, '기관 계정에서 확인된 이메일을 제공해야 합니다.');
  const address = email(claims.email), issuer = String(claims.iss || process.env.OIDC_ISSUER);
  let user;
  try {
    await mongoose.connection.transaction(async (session) => {
      user = await User.findOne({ email: address, isActive: true }).session(session);
      if (!user) fail(403, '활성 사용자 계정이 있어야 기관 계정과 연결할 수 있습니다.');
      if (user.oidcSubject && (user.oidcSubject !== claims.sub || user.oidcIssuer !== issuer)) fail(403, '이 계정은 다른 기관 계정에 연결되어 있습니다.');
      if (!user.oidcSubject) {
        user.oidcIssuer = issuer; user.oidcSubject = claims.sub; user.ssoOnly = true;
        await user.save({ session });
      }
      await appendAudit({ userId: user._id, userName: user.name, userEmail: user.email, action: 'OIDC_LOGIN', targetType: 'AUTH', targetId: String(user._id), description: '기관 계정 로그인', ipAddress: req.ip, session });
    });
  } catch (error) { if (error.code === 11000) fail(409, '이미 다른 사용자 계정에 연결된 기관 계정입니다.'); throw error; }
  setSessionCookie(res, user);
  const base = process.env.PUBLIC_BASE_URL || (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0];
  res.redirect(303, new URL('/', base).href);
});

export { setSessionCookie, issueToken };
export default router;
