import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../../models/User.js';
import UserSigningKey from '../../models/UserSigningKey.js';
import { fail } from '../core.js';
import { audit } from '../audit.js';
import { createSigningKey, decryptSecret, decryptSigningKey, sign, verifyTotp } from '../crypto.js';
import { canonicalize, sha256 } from '../canonical.js';

const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 10;
const MAX_TRACKED_USERS = 10000;
export class FailureWindow {
  constructor({ windowMs = WINDOW_MS, limit = LIMIT, maxEntries = MAX_TRACKED_USERS } = {}) {
    this.windowMs = windowMs;
    this.limit = limit;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }
  recordFailure(userId) {
    const now = Date.now();
    for (const [key, entry] of this.entries) if (entry.until <= now) this.entries.delete(key);
    const entry = this.entries.get(userId);
    if (!entry || entry.until <= now) {
      if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value);
      this.entries.set(userId, { count: 1, until: now + this.windowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > this.limit) fail(429, '서명 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.');
  }
  clear(userId) { this.entries.delete(userId); }
  get size() { return this.entries.size; }
}
const attempts = new FailureWindow();

export async function credentialsValid(user, password, totp) {
  if (!user || !user.isActive || (user.signingLockedUntil && user.signingLockedUntil > new Date())) return false;
  if (!(await bcrypt.compare(password, user.password))) return false;
  if (user.mfaEnabled) {
    if (!user.mfaSecretEncrypted) return false;
    return verifyTotp(await decryptSecret(user.mfaSecretEncrypted), totp);
  }
  return true;
}

export async function requireSigningCredentials(req) {
  const password = req.body.password;
  if (typeof password !== 'string' || !password) fail(400, '서명 비밀번호가 필요합니다.');
  let user = await User.findById(req.user.id);
  const valid = await credentialsValid(user, password, req.body.totp);
  if (!valid) {
    await mongoose.connection.transaction(async (session) => {
      user = await User.findById(req.user.id).session(session);
      if (user) {
        user.signingFailures = (user.signingFailures || 0) + 1;
        if (user.signingFailures >= 5) user.signingLockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        await user.save({ session });
      }
      await audit(req, 'SIGN_FAILED', 'AUTH', user || { _id: req.user.id }, null, session, '서명 재인증 실패');
    });
    attempts.recordFailure(req.user.id);
    fail(400, '서명 비밀번호 또는 인증 코드가 일치하지 않습니다.');
  }
  attempts.clear(req.user.id);
  return { password, user };
}

export async function resetSigningFailures(userId, session) {
  await User.updateOne({ _id: userId }, { $set: { signingFailures: 0, signingLockedUntil: null } }, { session });
}

export async function signWithUser(user, password, message, session) {
  let key = await UserSigningKey.findOne({ userId: user._id, active: true }).session(session);
  if (!key) {
    const data = await createSigningKey(user._id, password);
    [key] = await UserSigningKey.create([data], { session });
  }
  const privateKey = await decryptSigningKey(key, password);
  const text = Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf8');
  return {
    keyId: key.keyId, algorithm: 'Ed25519', publicKey: key.publicKey,
    signature: sign(privateKey, text), signedAt: new Date(),
  };
}

export function reviewerMessage(manifestSha256, authorSignature) {
  return sha256(canonicalize({ manifestSha256, authorSignature }));
}

export function signaturePayload(signature, { role, user, comment, manifestSha256, version, decision = 'approve' }) {
  return {
    role, userId: user._id, name: user.name, email: user.email, signedAt: signature.signedAt,
    keyId: signature.keyId, algorithm: signature.algorithm, publicKey: signature.publicKey,
    signature: signature.signature, manifestSha256, version, comment, decision,
    signatureHash: sha256(signature.signature), contentHash: manifestSha256, isValid: true,
  };
}

export function verifySignature(publicKey, message, signature) {
  try { return crypto.verify(null, Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf8'), publicKey, Buffer.from(signature, 'base64')); }
  catch { return false; }
}
