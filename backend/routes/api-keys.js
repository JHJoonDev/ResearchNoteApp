import express from 'express';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import ApiKey from '../models/ApiKey.js';
import { auth, writer } from '../middleware/auth.js';
import { audit, fail, objectId, text } from '../lib/core.js';

const router = express.Router(); router.use(auth);
const scopesAllowed = ['notes:read', 'inventory:read', 'inbox:write'];
const view = (item) => ({ id: String(item._id), name: item.name, prefix: item.prefix, scopes: item.scopes, expiresAt: item.expiresAt || null, createdAt: item.createdAt, lastUsedAt: item.lastUsedAt || null, revokedAt: item.revokedAt || null });
router.get('/', async (req, res) => res.json(await ApiKey.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean().then((items) => items.map(view))));
router.post('/', writer, async (req, res) => {
  const name = text(req.body.name, 'API 키 이름', 120);
  if (!Array.isArray(req.body.scopes) || !req.body.scopes.length || req.body.scopes.some((scope) => !scopesAllowed.includes(scope)) || new Set(req.body.scopes).size !== req.body.scopes.length) fail(400, 'API 키 권한을 확인해주세요.');
  let expiresAt;
  if (req.body.expiresAt !== undefined && req.body.expiresAt !== null && req.body.expiresAt !== '') { expiresAt = new Date(req.body.expiresAt); if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) fail(400, '만료 일시는 미래 날짜여야 합니다.'); }
  const prefix = crypto.randomBytes(6).toString('hex'), secret = crypto.randomBytes(32).toString('base64url'), keyValue = `lh_${prefix}_${secret}`;
  let doc;
  await mongoose.connection.transaction(async (session) => {
    [doc] = await ApiKey.create([{ name, prefix, hash: crypto.createHash('sha256').update(keyValue).digest('hex'), scopes: req.body.scopes, userId: req.user.id, expiresAt }], { session });
    await audit(req, 'CREATE', 'API_KEY', doc, null, session, 'API 키 생성');
  });
  res.status(201).json({ ...view(doc), key: keyValue });
});
router.delete('/:id', writer, async (req, res) => {
  const id = objectId(req.params.id);
  await mongoose.connection.transaction(async (session) => {
    const doc = await ApiKey.findOne({ _id: id, userId: req.user.id }).session(session); if (!doc) fail(404, 'API 키를 찾을 수 없습니다.');
    if (!doc.revokedAt) { const before = view(doc); doc.revokedAt = new Date(); await doc.save({ session }); await audit(req, 'REVOKE', 'API_KEY', doc, before, session, 'API 키 폐기'); }
  });
  res.json({ success: true });
});
export default router;
