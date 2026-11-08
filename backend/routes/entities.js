import express from 'express';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import EntityType from '../models/EntityType.js';
import Entity from '../models/Entity.js';
import Location from '../models/Location.js';
import Booking from '../models/Booking.js';
import Project from '../models/Project.js';
import { auth, adminOnly, writer } from '../middleware/auth.js';
import { audit, fail, objectId, projectAccess, text } from '../lib/core.js';

const router = express.Router();
router.use('/entity-types', auth);
router.use('/entities', auth);
router.use('/equipment', auth);
router.use('/bookings', auth);
const kinds = ['text', 'number', 'date', 'select'];

function normalizeFields(fields, existing = []) {
  if (!Array.isArray(fields) || fields.length > 100) fail(400, '사용자 정의 필드를 확인해주세요.');
  const prior = new Map(existing.map((field) => [field.id, field]));
  const ids = new Set();
  return fields.map((field) => {
    const id = field.id === undefined ? crypto.randomUUID() : text(field.id, '필드 ID', 80);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) fail(400, '필드 ID에는 영문자, 숫자, 하이픈, 밑줄만 사용할 수 있습니다.');
    if (ids.has(id)) fail(400, '필드 ID가 중복되었습니다.');
    ids.add(id);
    const kind = field.kind;
    if (!kinds.includes(kind)) fail(400, '필드 종류를 확인해주세요.');
    if (prior.has(id) && prior.get(id).kind !== kind) {
      // Checked against live entity values by the caller.
    }
    const options = field.options === undefined ? [] : field.options;
    if (!Array.isArray(options) || options.length > 100 || options.some((v) => typeof v !== 'string' || v.length > 200)) fail(400, '선택 항목을 확인해주세요.');
    return { id, name: text(field.name, '필드 이름', 120), kind, options, required: field.required === true };
  });
}
async function typeData(body, existing = null) {
  const name = text(body.name, '유형 이름', 120);
  if (!['sample', 'equipment', 'other'].includes(body.kind)) fail(400, '개체 유형을 확인해주세요.');
  const fields = normalizeFields(body.fields, existing?.fields || []);
  if (existing) {
    const next = new Map(fields.map((field) => [field.id, field]));
    for (const old of existing.fields) {
      const now = next.get(old.id);
      const changed = !now || now.kind !== old.kind;
      if (!changed) continue;
      const query = { typeId: existing._id, isDeleted: false, [`values.${old.id}`]: { $exists: true } };
      if (await Entity.exists(query)) fail(409, '사용 중인 필드는 삭제하거나 종류를 바꿀 수 없습니다.');
    }
  }
  return { name, kind: body.kind, fields };
}
function validateValues(type, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) fail(400, '개체 속성은 객체여야 합니다.');
  const fieldIds = new Set(type.fields.map((field) => field.id));
  if (Object.keys(values).some((id) => !fieldIds.has(id))) fail(400, '등록되지 않은 개체 속성이 있습니다.');
  const clean = {};
  for (const field of type.fields) {
    const value = values[field.id];
    if ((value === undefined || value === null || value === '') && field.required) fail(400, `필수 항목을 입력해주세요: ${field.name}`);
    if (value === undefined || value === null || value === '') continue;
    if (field.kind === 'text' && typeof value !== 'string') fail(400, `${field.name}은(는) 문자열이어야 합니다.`);
    if (field.kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) fail(400, `${field.name}은(는) 숫자여야 합니다.`);
    if (field.kind === 'date' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) fail(400, `${field.name} 날짜를 확인해주세요.`);
    if (field.kind === 'select' && (!field.options.includes(value))) fail(400, `${field.name} 선택 항목을 확인해주세요.`);
    clean[field.id] = value;
  }
  return clean;
}
async function entityData(req, body, existing, session) {
  const data = {};
  if (!existing || body.typeId !== undefined) {
    data.typeId = objectId(body.typeId ?? String(existing.typeId));
    data.type = await EntityType.findOne({ _id: data.typeId, isDeleted: false }).session(session);
    if (!data.type) fail(400, '개체 유형을 찾을 수 없습니다.');
  }
  const type = data.type || await EntityType.findById(existing.typeId).session(session);
  if (!existing || body.code !== undefined) data.code = text(body.code, '개체 코드', 100);
  if (!existing || body.name !== undefined) data.name = text(body.name, '개체 이름', 200);
  if (!existing || body.values !== undefined || body.typeId !== undefined) data.values = validateValues(type, body.values ?? existing?.values ?? {});
  if (existing) await projectAccess(req.user, existing.projectId, true, session);
  if (!existing || body.projectId !== undefined) {
    data.projectId = body.projectId ? objectId(body.projectId) : null;
    await projectAccess(req.user, data.projectId, true, session);
  }
  if (!existing || body.locationId !== undefined) {
    data.locationId = body.locationId ? objectId(body.locationId) : null;
    if (data.locationId && !(await Location.exists({ _id: data.locationId, isDeleted: false }).session(session))) fail(400, '보관 위치를 찾을 수 없습니다.');
  }
  if (!existing || body.position !== undefined) {
    if (body.position == null) data.position = undefined;
    else {
      const { row, col } = body.position || {};
      if (!Number.isInteger(row) || row < 1 || !Number.isInteger(col) || col < 1) fail(400, '보관함 칸을 확인해주세요.');
      data.position = { row, col };
    }
  }
  if (!existing || body.status !== undefined) {
    data.status = body.status ?? 'active';
    if (!['active', 'in_use', 'retired'].includes(data.status)) fail(400, '개체 상태를 확인해주세요.');
  }
  if (type.kind === 'equipment' && (!existing || body.calibrationDueAt !== undefined)) {
    if (body.calibrationDueAt == null || body.calibrationDueAt === '') data.calibrationDueAt = undefined;
    else {
      const date = new Date(body.calibrationDueAt);
      if (!Number.isFinite(date.getTime())) fail(400, '교정 예정일을 확인해주세요.');
      data.calibrationDueAt = date;
    }
  }
  const existingValues = existing?.toObject();
  const effectiveLocationId = Object.hasOwn(data, 'locationId') ? data.locationId : existingValues?.locationId || null;
  const effectivePosition = Object.hasOwn(data, 'position') ? data.position : existingValues?.position;
  if (effectivePosition) {
    if (!effectiveLocationId) fail(400, '칸을 지정하려면 보관 위치가 필요합니다.');
    const loc = await Location.findOne({ _id: effectiveLocationId, isDeleted: false }).session(session);
    if (!Number.isInteger(loc?.grid?.rows) || !Number.isInteger(loc?.grid?.cols) || effectivePosition.row > loc.grid.rows || effectivePosition.col > loc.grid.cols) fail(400, '보관함 칸이 범위를 벗어났습니다.');
  }
  delete data.type;
  return data;
}
async function canReadEntity(req, entity) {
  if (entity.projectId) await projectAccess(req.user, entity.projectId, false);
}

router.get('/entity-types', async (req, res) => res.json(await EntityType.find({ isDeleted: false }).sort({ name: 1 }).lean()));
router.post('/entity-types', adminOnly, async (req, res) => {
  let doc;
  await mongoose.connection.transaction(async (session) => {
    [doc] = await EntityType.create([await typeData(req.body)], { session });
    await audit(req, 'CREATE', 'ENTITY_TYPE', doc, null, session);
  });
  res.status(201).json(doc);
});
router.put('/entity-types/:id', adminOnly, async (req, res) => {
  const id = objectId(req.params.id);
  let doc;
  await mongoose.connection.transaction(async (session) => {
    doc = await EntityType.findOne({ _id: id, isDeleted: false }).session(session);
    if (!doc) fail(404, '개체 유형을 찾을 수 없습니다.');
    const before = doc.toObject();
    Object.assign(doc, await typeData(req.body, doc));
    await doc.save({ session });
    await audit(req, 'UPDATE', 'ENTITY_TYPE', doc, before, session);
  });
  res.json(doc);
});
router.delete('/entity-types/:id', adminOnly, async (req, res) => {
  const id = objectId(req.params.id);
  await mongoose.connection.transaction(async (session) => {
    const doc = await EntityType.findOne({ _id: id, isDeleted: false }).session(session);
    if (!doc) fail(404, '개체 유형을 찾을 수 없습니다.');
    if (await Entity.exists({ typeId: id, isDeleted: false }).session(session)) fail(409, '개체가 사용 중인 유형은 삭제할 수 없습니다.');
    const before = doc.toObject(); doc.isDeleted = true; await doc.save({ session });
    await audit(req, 'DELETE', 'ENTITY_TYPE', doc, before, session);
  });
  res.json({ success: true });
});

router.get('/equipment/alerts', async (req, res) => {
  const cutoff = new Date(Date.now() + 30 * 86400000);
  const typeIds = await EntityType.find({ kind: 'equipment', isDeleted: false }).distinct('_id');
  const filter = { typeId: { $in: typeIds }, isDeleted: false, calibrationDueAt: { $lte: cutoff } };
  if (req.user.role !== 'admin') {
    const projects = await Project.find({ 'members.userId': req.user.id, isDeleted: false }).distinct('_id');
    filter.$or = [{ projectId: null }, { projectId: { $in: projects } }];
  }
  res.json(await Entity.find(filter).sort({ calibrationDueAt: 1 }).lean());
});
router.get('/entities', async (req, res) => {
  const page = Number(req.query.page || 1), limit = Number(req.query.limit || 50);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, '페이지 값을 확인해주세요.');
  const filter = { isDeleted: false };
  if (req.query.typeId) filter.typeId = objectId(req.query.typeId);
  if (req.query.projectId) {
    const pid = objectId(req.query.projectId); await projectAccess(req.user, pid, false); filter.projectId = pid;
  } else if (req.user.role !== 'admin') {
    const ids = await Project.find({ 'members.userId': req.user.id, isDeleted: false }).distinct('_id');
    filter.$or = [{ projectId: null }, { projectId: { $in: ids } }];
  }
  if (req.query.q) { const q = text(req.query.q, '검색어', 100); filter.$and = [{ $or: [{ code: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }] }]; }
  const [items, total] = await Promise.all([Entity.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Entity.countDocuments(filter)]);
  res.json({ items, total, page, limit });
});
router.post('/entities', writer, async (req, res) => {
  let entity;
  await mongoose.connection.transaction(async (session) => {
    const data = await entityData(req, req.body, null, session);
    [entity] = await Entity.create([data], { session });
    await audit(req, 'CREATE', 'ENTITY', entity, null, session);
  });
  res.status(201).json(entity);
});
router.get('/entities/:id/bookings', async (req, res) => {
  const id = objectId(req.params.id);
  const entity = await Entity.findOne({ _id: id, isDeleted: false });
  if (!entity) fail(404, '개체를 찾을 수 없습니다.'); await canReadEntity(req, entity);
  const from = req.query.from ? new Date(req.query.from) : new Date(0), to = req.query.to ? new Date(req.query.to) : new Date('9999-12-31');
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) fail(400, '예약 기간을 확인해주세요.');
  res.json(await Booking.find({ entityId: id, status: 'booked', start: { $lt: to }, end: { $gt: from } }).sort({ start: 1 }).lean());
});
router.post('/entities/:id/bookings', writer, async (req, res) => {
  const id = objectId(req.params.id); let booking;
  await mongoose.connection.transaction(async (session) => {
    const entity = await Entity.findOne({ _id: id, isDeleted: false }).session(session);
    if (!entity) fail(404, '개체를 찾을 수 없습니다.'); await projectAccess(req.user, entity.projectId, true, session);
    const type = await EntityType.findOne({ _id: entity.typeId, isDeleted: false }).session(session);
    if (type?.kind !== 'equipment') fail(400, '장비만 예약할 수 있습니다.');
    const start = new Date(req.body.start), end = new Date(req.body.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) fail(400, '예약 시간을 확인해주세요.');
    // Serialize competing reservations on the equipment document; transaction conflicts force a retry.
    await Entity.updateOne({ _id: id, isDeleted: false }, { $inc: { __v: 1 } }, { session });
    if (await Booking.exists({ entityId: id, status: 'booked', start: { $lt: end }, end: { $gt: start } }).session(session)) fail(409, '해당 시간에 이미 예약이 있습니다.');
    [booking] = await Booking.create([{ entityId: id, userId: req.user.id, start, end, purpose: text(req.body.purpose, '예약 목적', 1000) }], { session });
    await audit(req, 'CREATE', 'BOOKING', booking, null, session);
  });
  res.status(201).json(booking);
});
router.get('/entities/:id', async (req, res) => {
  const entity = await Entity.findOne({ _id: objectId(req.params.id), isDeleted: false }).lean();
  if (!entity) fail(404, '개체를 찾을 수 없습니다.'); await canReadEntity(req, entity); res.json(entity);
});
router.put('/entities/:id', writer, async (req, res) => {
  const id = objectId(req.params.id); let entity;
  await mongoose.connection.transaction(async (session) => {
    entity = await Entity.findOne({ _id: id, isDeleted: false }).session(session);
    if (!entity) fail(404, '개체를 찾을 수 없습니다.');
    const before = entity.toObject(); Object.assign(entity, await entityData(req, req.body, entity, session));
    await entity.save({ session }); await audit(req, 'UPDATE', 'ENTITY', entity, before, session);
  });
  res.json(entity);
});
router.delete('/entities/:id', writer, async (req, res) => {
  const id = objectId(req.params.id);
  await mongoose.connection.transaction(async (session) => {
    const entity = await Entity.findOne({ _id: id, isDeleted: false }).session(session);
    if (!entity) fail(404, '개체를 찾을 수 없습니다.'); await projectAccess(req.user, entity.projectId, true, session);
    const before = entity.toObject(); entity.isDeleted = true; await entity.save({ session }); await audit(req, 'DELETE', 'ENTITY', entity, before, session);
  });
  res.json({ success: true });
});
export async function cancelBooking(req, res) {
  const id = objectId(req.params.id);
  await mongoose.connection.transaction(async (session) => {
    const booking = await Booking.findById(id).session(session); if (!booking || booking.status !== 'booked') fail(404, '예약을 찾을 수 없습니다.');
    const entity = await Entity.findById(booking.entityId).session(session); if (!entity) fail(404, '장비를 찾을 수 없습니다.');
    await projectAccess(req.user, entity.projectId, true, session);
    if (String(booking.userId) !== req.user.id && req.user.role !== 'admin') fail(403, '예약자 또는 관리자만 취소할 수 있습니다.');
    const before = booking.toObject(); booking.status = 'cancelled'; await booking.save({ session }); await audit(req, 'CANCEL', 'BOOKING', booking, before, session);
  });
  res.json({ success: true });
}
router.delete('/bookings/:id', writer, cancelBooking);
export { validateValues, normalizeFields };
export default router;
