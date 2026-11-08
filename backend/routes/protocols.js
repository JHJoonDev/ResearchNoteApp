import express from 'express';
import mongoose from 'mongoose';
import Protocol from '../models/Protocol.js';
import ProtocolVersion from '../models/ProtocolVersion.js';
import { auth, writer } from '../middleware/auth.js';
import { audit, fail, objectId, projectAccess, text } from '../lib/core.js';

const router = express.Router();
const visible = async (protocol, user, session) => {
  if (protocol.projectId) return projectAccess(user, protocol.projectId, false, session);
  if (user.role !== 'admin' && String(protocol.createdBy) !== user.id) fail(403, '개인 프로토콜에 접근할 수 없습니다.');
};
const editable = async (protocol, user, session) => {
  if (protocol.projectId) return projectAccess(user, protocol.projectId, true, session);
  if (user.role !== 'admin' && String(protocol.createdBy) !== user.id) fail(403, '개인 프로토콜에 접근할 수 없습니다.');
};
function protocolFields(body) {
  const title = text(body.title, '제목', 200);
  const description = text(body.description ?? '', '설명', 4000, false);
  const inputSteps = body.steps === undefined ? [] : body.steps;
  if (!Array.isArray(inputSteps) || inputSteps.length > 200) fail(400, '단계는 배열로 200개까지 입력할 수 있습니다.');
  const stepIds = new Set();
  const steps = inputSteps.map((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) fail(400, '단계 형식이 올바르지 않습니다.');
    const id = text(step.id, '단계 ID', 100);
    if (stepIds.has(id)) fail(400, '단계 ID는 중복될 수 없습니다.');
    stepIds.add(id);
    const stepTitle = text(step.title, '단계 제목', 200);
    const instructions = text(step.instructions ?? '', '단계 안내', 10000, false);
    const checklistInput = step.checklist === undefined ? [] : step.checklist;
    const fieldInput = step.resultFields === undefined ? [] : step.resultFields;
    if (!Array.isArray(checklistInput) || checklistInput.length > 100) fail(400, '체크 항목은 단계마다 100개까지 입력할 수 있습니다.');
    if (!Array.isArray(fieldInput) || fieldInput.length > 100) fail(400, '결과 항목은 단계마다 100개까지 입력할 수 있습니다.');
    const checklistIds = new Set();
    const checklist = checklistInput.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) fail(400, '체크 항목 형식이 올바르지 않습니다.');
      const itemId = text(item.id, '체크 항목 ID', 100);
      if (checklistIds.has(itemId)) fail(400, '체크 항목 ID는 중복될 수 없습니다.');
      checklistIds.add(itemId);
      return { id: itemId, text: text(item.text, '체크 항목', 500) };
    });
    const fieldIds = new Set();
    const resultFields = fieldInput.map((field) => {
      if (!field || typeof field !== 'object' || Array.isArray(field)) fail(400, '결과 항목 형식이 올바르지 않습니다.');
      const fieldId = text(field.id, '결과 항목 ID', 100);
      if (fieldIds.has(fieldId)) fail(400, '결과 항목 ID는 중복될 수 없습니다.');
      fieldIds.add(fieldId);
      if (!['text', 'number'].includes(field.kind)) fail(400, '결과 항목 형식은 텍스트 또는 숫자여야 합니다.');
      return { id: fieldId, name: text(field.name, '결과 항목 이름', 200), unit: text(field.unit ?? '', '단위', 80, false), kind: field.kind };
    });
    return { id, title: stepTitle, instructions, checklist, resultFields };
  });
  return { title, description, steps };
}

router.get('/protocols', auth, async (req, res) => {
  const projectIds = req.user.role === 'admin' ? null : await mongoose.model('Project').find({ isDeleted: false, 'members.userId': req.user.id }).distinct('_id');
  const filter = { isDeleted: false, ...(projectIds ? { $or: [{ projectId: { $in: projectIds } }, { projectId: null, createdBy: req.user.id }] } : {}) };
  res.json(await Protocol.find(filter).sort({ updatedAt: -1 }));
});

router.post('/protocols', auth, writer, async (req, res) => {
  let protocol;
  await mongoose.connection.transaction(async (session) => {
    const projectId = req.body.projectId ? objectId(req.body.projectId) : null;
    if (projectId) await projectAccess(req.user, projectId, true, session);
    const fields = protocolFields(req.body);
    [protocol] = await Protocol.create([{ ...fields, projectId, createdBy: req.user.id }], { session });
    await audit(req, 'PROTOCOL_CREATE', 'PROTOCOL', protocol, null, session);
  });
  res.status(201).json(protocol);
});

router.get('/protocols/:id', auth, async (req, res) => {
  const protocol = await Protocol.findOne({ _id: objectId(req.params.id), isDeleted: false });
  if (!protocol) fail(404, '프로토콜이 없습니다.');
  await visible(protocol, req.user);
  res.json(protocol);
});

router.put('/protocols/:id', auth, writer, async (req, res) => {
  let protocol;
  await mongoose.connection.transaction(async (session) => {
    protocol = await Protocol.findOne({ _id: objectId(req.params.id), isDeleted: false }).session(session);
    if (!protocol) fail(404, '프로토콜이 없습니다.');
    await editable(protocol, req.user, session);
    if (protocol.status === 'archived') fail(409, '보관된 프로토콜은 수정할 수 없습니다.');
    const before = protocol.toObject();
    const fields = protocolFields(req.body);
    if (protocol.status === 'published') { protocol.status = 'draft'; protocol.version += 1; }
    Object.assign(protocol, fields);
    await protocol.save({ session });
    await audit(req, 'PROTOCOL_UPDATE', 'PROTOCOL', protocol, before, session);
  });
  res.json(protocol);
});

router.delete('/protocols/:id', auth, writer, async (req, res) => {
  await mongoose.connection.transaction(async (session) => {
    const protocol = await Protocol.findOne({ _id: objectId(req.params.id), isDeleted: false }).session(session);
    if (!protocol) fail(404, '프로토콜이 없습니다.');
    await editable(protocol, req.user, session);
    const before = protocol.toObject(); protocol.status = 'archived'; protocol.isDeleted = true;
    await protocol.save({ session });
    await audit(req, 'PROTOCOL_DELETE', 'PROTOCOL', protocol, before, session);
  });
  res.json({ success: true });
});

router.post('/protocols/:id/publish', auth, writer, async (req, res) => {
  let protocol;
  await mongoose.connection.transaction(async (session) => {
    protocol = await Protocol.findOne({ _id: objectId(req.params.id), isDeleted: false }).session(session);
    if (!protocol) fail(404, '프로토콜이 없습니다.');
    await editable(protocol, req.user, session);
    if (protocol.status !== 'draft') fail(409, '초안 상태의 프로토콜만 게시할 수 있습니다.');
    const snapshot = { protocolId: String(protocol._id), version: protocol.version, projectId: protocol.projectId ? String(protocol.projectId) : null, title: protocol.title, description: protocol.description, steps: protocol.steps.map((step) => step.toObject ? step.toObject() : step) };
    await ProtocolVersion.create([{ protocolId: protocol._id, version: protocol.version, snapshot, publishedBy: req.user.id }], { session });
    const before = protocol.toObject(); protocol.status = 'published';
    await protocol.save({ session });
    await audit(req, 'PROTOCOL_PUBLISH', 'PROTOCOL', protocol, before, session);
  });
  res.json(protocol);
});

router.get('/protocols/:id/versions', auth, async (req, res) => {
  const protocol = await Protocol.findOne({ _id: objectId(req.params.id), isDeleted: false });
  if (!protocol) fail(404, '프로토콜이 없습니다.');
  await visible(protocol, req.user);
  res.json(await ProtocolVersion.find({ protocolId: protocol._id }).sort({ version: -1 }));
});

export default router;
