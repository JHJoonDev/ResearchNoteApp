import express from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { text, objectId, fail, audit } from '../lib/core.js';
import { email, password } from './auth.js';
import UserSigningKey from '../models/UserSigningKey.js';
import AccountToken from '../models/AccountToken.js';
import { randomToken, digest } from '../lib/crypto.js';
import { mailConfigured, sendMail } from '../lib/mail/index.js';
import { runBackground } from '../lib/background.js';
const router = express.Router();
const view = (m) => ({ id: String(m._id), name: m.name, email: m.email, role: m.role, isActive: m.isActive !== false });
async function lockAdmins(req, session) {
  await mongoose.connection
    .collection('setup')
    .updateOne({ _id: 'admin-membership' }, { $inc: { revision: 1 } }, { upsert: true, session });
  const actor = await User.findById(req.user.id).session(session);
  if (actor?.role !== 'admin' || !actor.isActive) fail(403, '관리자 권한이 변경되었습니다.');
}
async function ensureAdminLock() {
  try {
    await mongoose.connection.collection('setup').updateOne(
      { _id: 'admin-membership' }, { $setOnInsert: { revision: 0 } }, { upsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}
router.use(auth);
router.get('/', async (req, res) =>
  res.json((await User.find().select('-password').sort({ name: 1 })).map(view)),
);
router.post('/', adminOnly, async (req, res) => {
  const invite = req.body.invite === true;
  if (invite && !mailConfigured()) fail(503, '메일 발송이 설정되어 있지 않습니다.');
  const inviteToken = invite ? randomToken() : null;
  const fields = {
    name: text(req.body.name, '이름'),
    email: email(req.body.email),
    password: await bcrypt.hash(invite ? randomToken() : password(req.body.password), 12),
    role: req.body.role || 'researcher',
  };
  let created;
  await mongoose.connection.transaction(async (session) => {
    const [member] = await User.create([fields], { session });
    created = member;
    if (invite) await AccountToken.create([{ userId: member._id, tokenHash: digest(inviteToken), purpose: 'invite', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }], { session });
    await audit(req, 'CREATE', 'USER', { ...view(member), _id: member._id }, null, session);
    res.locals.member = view(member);
  });
  if (invite) {
    const base = (process.env.PUBLIC_BASE_URL || process.env.CORS_ORIGIN?.split(',')[0] || '').replace(/\/$/, '');
    const link = `${base}/invite#${inviteToken}`;
    runBackground(() => sendMail({ to: created.email, subject: 'LabHub 초대', text: `7일 안에 다음 링크에서 비밀번호를 설정해주세요: ${link}` }), '초대 이메일 발송 실패');
  }
  res.status(201).json(res.locals.member);
});
router.put('/:id', adminOnly, async (req, res) => {
  await ensureAdminLock();
  let response;
  await mongoose.connection.transaction(async (session) => {
    await lockAdmins(req, session);
    const member = await User.findById(objectId(req.params.id)).session(session);
    if (!member) fail(404, '멤버가 없습니다.');
    if (req.params.id === req.user.id && req.body.role !== 'admin')
      fail(400, '본인의 관리자 권한은 변경할 수 없습니다.');
    const before = view(member);
    if (req.body.role && !['admin', 'researcher', 'viewer'].includes(req.body.role)) fail(400, '권한을 확인해주세요.');
    if (req.body.name !== undefined) member.name = text(req.body.name, '이름');
    if (req.body.email !== undefined) member.email = email(req.body.email);
    member.role = req.body.role || member.role;
    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== 'boolean') fail(400, '계정 상태를 확인해주세요.');
      if (member.role === 'admin' && member.isActive && !req.body.isActive && await User.countDocuments({ role: 'admin', isActive: true }).session(session) <= 1)
        fail(409, '마지막 관리자 계정은 비활성화할 수 없습니다.');
      member.isActive = req.body.isActive;
    }
    member.tokenVersion += 1;
    if (req.body.password) {
      member.password = await bcrypt.hash(password(req.body.password), 12);
      const keys = await UserSigningKey.find({ userId: member._id, active: true }).session(session);
      for (const key of keys) { key.active = false; key.revokedAt = new Date(); key.revokeReason = '관리자 비밀번호 재설정'; await key.save({ session }); }
    }
    await member.save({ session });
    await audit(req, 'UPDATE', 'USER', { ...view(member), _id: member._id }, before, session);
    response = view(member);
  });
  res.json(response);
});
router.delete('/:id', adminOnly, async (req, res) => {
  if (req.params.id === req.user.id) fail(400, '본인 계정은 삭제할 수 없습니다.');
  await ensureAdminLock();
  await mongoose.connection.transaction(async (session) => {
    await lockAdmins(req, session);
    const member = await User.findById(objectId(req.params.id)).session(session);
    if (!member) fail(404, '멤버가 없습니다.');
    if (member.role === 'admin' && member.isActive && await User.countDocuments({ role: 'admin', isActive: true }).session(session) <= 1)
      fail(409, '마지막 관리자 계정은 비활성화할 수 없습니다.');
    const before = view(member);
    member.isActive = false;
    member.tokenVersion += 1;
    await member.save({ session });
    await audit(req, 'USER_DEACTIVATE', 'USER', { ...view(member), _id: member._id }, before, session);
  });
  res.json({ success: true, isActive: false });
});
export default router;
