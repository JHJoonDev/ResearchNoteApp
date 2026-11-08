import express from 'express';
import mongoose from 'mongoose';
import Location from '../models/Location.js';
import Entity from '../models/Entity.js';
import LimsLot from '../models/LimsLot.js';
import { auth, writer } from '../middleware/auth.js';
import { audit, fail, objectId, text } from '../lib/core.js';

const router = express.Router();
router.use(auth);

function locationData(body, current = null) {
  const data = {};
  if (body.parentId !== undefined) data.parentId = body.parentId ? objectId(body.parentId) : null;
  if (body.name !== undefined || !current) data.name = text(body.name, '위치 이름', 120);
  if (body.kind !== undefined || !current) {
    data.kind = body.kind;
    if (!['room', 'freezer', 'shelf', 'box', 'other'].includes(data.kind)) fail(400, '위치 종류를 확인해주세요.');
  }
  if (body.grid !== undefined || !current) {
    if (body.grid == null) data.grid = undefined;
    else {
      const { rows, cols } = body.grid || {};
      if (!Number.isInteger(rows) || rows < 1 || rows > 500 || !Number.isInteger(cols) || cols < 1 || cols > 500)
        fail(400, '보관함 행과 열을 확인해주세요.');
      data.grid = { rows, cols };
    }
  }
  return data;
}
async function ensureNoCycle(id, parentId, session) {
  let at = parentId;
  const seen = new Set();
  while (at) {
    if (String(at) === String(id)) fail(409, '위치 상위 경로에 순환이 생깁니다.');
    if (seen.has(String(at))) fail(409, '기존 위치 경로에 순환이 있습니다.');
    seen.add(String(at));
    const parent = await Location.findOne({ _id: at, isDeleted: false }).select('parentId').session(session);
    if (!parent) fail(400, '상위 위치를 찾을 수 없습니다.');
    at = parent.parentId;
  }
}

router.get('/', async (req, res) => res.json(await Location.find({ isDeleted: false }).sort({ name: 1 }).lean()));
router.post('/', writer, async (req, res) => {
  let location;
  await mongoose.connection.transaction(async (session) => {
    const data = locationData(req.body);
    if (data.parentId) await ensureNoCycle(null, data.parentId, session);
    [location] = await Location.create([{ ...data, isDeleted: false }], { session });
    await audit(req, 'CREATE', 'LOCATION', location, null, session);
  });
  res.status(201).json(location);
});
router.put('/:id', writer, async (req, res) => {
  const id = objectId(req.params.id);
  let location;
  await mongoose.connection.transaction(async (session) => {
    location = await Location.findOne({ _id: id, isDeleted: false }).session(session);
    if (!location) fail(404, '보관 위치를 찾을 수 없습니다.');
    const before = location.toObject();
    const data = locationData(req.body, location);
    if (data.parentId !== undefined) await ensureNoCycle(location._id, data.parentId, session);
    Object.assign(location, data);
    await location.save({ session });
    await audit(req, 'UPDATE', 'LOCATION', location, before, session);
  });
  res.json(location);
});
router.delete('/:id', writer, async (req, res) => {
  const id = objectId(req.params.id);
  await mongoose.connection.transaction(async (session) => {
    const location = await Location.findOne({ _id: id, isDeleted: false }).session(session);
    if (!location) fail(404, '보관 위치를 찾을 수 없습니다.');
    const [children, entities, lots] = await Promise.all([
      Location.exists({ parentId: id, isDeleted: false }).session(session),
      Entity.exists({ locationId: id, isDeleted: false }).session(session),
      LimsLot.exists({ locationId: id, isDeleted: false }).session(session),
    ]);
    if (children || entities || lots) fail(409, '하위 위치 또는 보관 중인 물품이 있어 삭제할 수 없습니다.');
    const before = location.toObject();
    location.isDeleted = true;
    await location.save({ session });
    await audit(req, 'DELETE', 'LOCATION', location, before, session);
  });
  res.json({ success: true });
});
export default router;
