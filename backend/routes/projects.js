import express from 'express';
import Project from '../models/Project.js';
import User from '../models/User.js';
import { auth, writer } from '../middleware/auth.js';
import { text, projectAccess, fail, objectId } from '../lib/core.js';
import mongoose from 'mongoose';
import { audit } from '../lib/core.js';
const router = express.Router();
router.use(auth);
router.get('/', async (req, res) =>
  res.json(
    await Project.find({
      isDeleted: false,
      ...(req.user.role === 'admin' ? {} : { 'members.userId': req.user.id }),
    }).sort({ createdAt: -1 }),
  ),
);
router.post('/', writer, async (req, res) => {
  let project;
  await mongoose.connection.transaction(async (session) => {
    [project] = await Project.create([{
      name: text(req.body.name, '프로젝트 이름'),
      description: text(req.body.description || '', '설명', 2000, false),
      endDate: parseEndDate(req.body.endDate),
      members: [{ userId: req.user.id, name: req.user.name, role: 'manager' }],
    }], { session });
    await audit(req, 'PROJECT_CREATE', 'PROJECT', project, null, session);
  });
  res.status(201).json(project);
});
router.put('/:id', writer, async (req, res) => {
  let project;
  await mongoose.connection.transaction(async (session) => {
    project = await projectAccess(req.user, req.params.id, true, session);
    if (req.user.role !== 'admin' && !project.members.some((m) => String(m.userId) === req.user.id && m.role === 'manager'))
      fail(403, '프로젝트 관리 권한이 필요합니다.');
    const before = project.toObject();
    if (req.body.name !== undefined) project.name = text(req.body.name, '프로젝트 이름');
    if (req.body.description !== undefined) project.description = text(req.body.description || '', '설명', 2000, false);
    if (req.body.endDate !== undefined) project.endDate = parseEndDate(req.body.endDate);
    if (req.body.members) {
      if (!Array.isArray(req.body.members) || req.body.members.length > 200) fail(400, '멤버 목록을 확인해주세요.');
      const seen = new Set();
      const members = [];
      for (const m of req.body.members) {
        objectId(m.userId);
        if (seen.has(m.userId)) fail(400, '중복 멤버입니다.');
        seen.add(m.userId);
        const user = await User.findOne({ _id: m.userId, isActive: true }).session(session);
        if (!user) fail(400, '등록된 사용자를 선택해주세요.');
        if (!['viewer', 'editor', 'manager'].includes(m.role)) fail(400, '프로젝트 역할을 확인해주세요.');
        members.push({ userId: user._id, name: user.name, role: m.role });
      }
      if (!members.some((m) => String(m.userId) === req.user.id && m.role === 'manager')) fail(400, '본인을 프로젝트 관리자로 유지해주세요.');
      project.members = members;
    }
    await project.save({ session });
    await audit(req, 'PROJECT_UPDATE', 'PROJECT', project, before, session);
  });
  res.json(project);
});

function parseEndDate(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, '과제 종료일을 확인해주세요.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail(400, '과제 종료일을 확인해주세요.');
  return date;
}
export default router;
